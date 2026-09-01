// =============================================================================
// mlx-queue.mjs — Faz 4
// MLX tek model / sınırlı GPU. Paralel chat+router+embedding+agent çağrıları
// bindirildiğinde LOCAL ${process.env.LOCAL_RUNTIME_PORT || 8001} takılır ve operatöre "Elara cevap vermiyor" gibi
// görünür. Bu kuyruk:
//   - sınırlı concurrency (default 1) + öncelikli FIFO sıra
//   - queued / running / done / cancelled / timeout durumları
//   - dışarıdan AbortSignal kabul eder; queued işin runner'ı abort edilir
//   - bekleyen istek max-wait aşarsa "timeout" düşer ve yer açılır
// Stream üreten görevler için `enqueueStream(...)` async iterator döndürür.
// =============================================================================

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { TIMEOUT_BUDGETS } from "./queue-config.mjs";

const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.MLX_QUEUE_CONCURRENCY || 1));
// 2026-05-29 — TIMEOUT_BUDGETS tek mercii (config-driven). UI override
// `RAG_SETTINGS.localQueueWaitMs` enqueue çağrısında opts.maxWaitMs ile gelir.
const DEFAULT_MAX_WAIT_MS = Math.max(1_000, TIMEOUT_BUDGETS.MLX_QUEUE_WAIT_MS);

class MlxQueue extends EventEmitter {
  constructor({ concurrency = DEFAULT_CONCURRENCY } = {}) {
    super();
    this.concurrency = concurrency;
    this.running = new Map(); // id -> entry
    this.pending = [];        // sorted by priority desc, then enqueuedAt asc
    // 2026-07-03 — Slot leak sensor. Every 5s while anything is queued we log
    // who is holding each running slot and how long they have held it. Behavior
    // unchanged — pure telemetry, no throttling / no cancellation.
    this._waitWatchdog = null;
    this.on("state", (ev) => {
      try {
        const idShort = String(ev.id || "").slice(0, 8);
        const entry = this.running.get(ev.id)
          || this.pending.find((p) => p.id === ev.id);
        const prio = entry ? entry.priority : "?";
        console.error(
          `[mlx.queue] ${ev.status} id=${idShort} label=${ev.label || "?"} prio=${prio} running=${this.running.size} queued=${this.pending.length}`,
        );
      } catch { /* log asla patlamasın */ }
      try { this._armWaitWatchdog(); } catch {}
    });
  }

  _armWaitWatchdog() {
    if (this.pending.length === 0) {
      if (this._waitWatchdog) { clearInterval(this._waitWatchdog); this._waitWatchdog = null; }
      return;
    }
    if (this._waitWatchdog) return;
    const t = setInterval(() => {
      try {
        if (this.pending.length === 0) {
          clearInterval(this._waitWatchdog); this._waitWatchdog = null; return;
        }
        const now = Date.now();
        const holders = [...this.running.values()].map((e) => ({
          id: String(e.id).slice(0, 8),
          label: e.label,
          ageMs: now - (e.startedAt || now),
          status: e.status,
        }));
        const waiters = this.pending.map((e) => ({
          id: String(e.id).slice(0, 8),
          label: e.label,
          waitedMs: now - (e.enqueuedAt || now),
        }));
        console.error(
          `[mlx.queue.wait] concurrency=${this.concurrency} holders=${JSON.stringify(holders)} waiters=${JSON.stringify(waiters)}`,
        );
      } catch {}
    }, 5_000);
    t.unref?.();
    this._waitWatchdog = t;
  }

  // 2026-06-26 — UI canlı override (System Engine → Runtime Safety).
  // Sonraki _drain() turunda yeni concurrency devreye girer; çalışan iş
  // kesilmez. n<1 ise 1'e clamp.
  setConcurrency(n) {
    const requested = Math.max(1, Math.floor(Number(n) || 1));
    const allowParallel = String(process.env.MLX_QUEUE_ALLOW_PARALLEL || "0") === "1";
    const v = allowParallel ? requested : 1;
    if (v === this.concurrency) return;
    this.concurrency = v;
    console.error(`[mlx.queue] concurrency=${v} (live override${!allowParallel && requested > 1 ? `; clamped from ${requested}` : ""})`);
    this._drain();
  }

  stats() {
    const now = Date.now();
    return {
      concurrency: this.concurrency,
      running: this.running.size,
      queued: this.pending.length,
      runningIds: [...this.running.keys()],
      queuedIds: this.pending.map(p => p.id),
      holders: [...this.running.values()].map((e) => ({
        id: e.id, label: e.label, ageMs: now - (e.startedAt || now), status: e.status,
      })),
      waiters: this.pending.map((e) => ({
        id: e.id, label: e.label, waitedMs: now - (e.enqueuedAt || now),
      })),
    };
  }

  _insertSorted(entry) {
    let i = 0;
    while (i < this.pending.length) {
      const p = this.pending[i];
      if (entry.priority > p.priority) break;
      if (entry.priority === p.priority && entry.enqueuedAt < p.enqueuedAt) break;
      i++;
    }
    this.pending.splice(i, 0, entry);
  }

  _drain() {
    while (this.running.size < this.concurrency && this.pending.length) {
      const entry = this.pending.shift();
      if (entry.cancelled) continue;
      this._runEntry(entry);
    }
  }

  async _runEntry(entry) {
    entry.status = "running";
    entry.startedAt = Date.now();
    this.running.set(entry.id, entry);
    this.emit("state", { id: entry.id, status: "running", label: entry.label });
    try {
      const result = await entry.task({ signal: entry.controller.signal });
      if (entry.cancelled) {
        entry.status = "cancelled";
        entry.reject(new Error(entry.cancelReason || "cancelled"));
      } else {
        entry.status = "done";
        entry.resolve(result);
      }
    } catch (err) {
      if (entry.controller.signal.aborted && !entry.cancelled) {
        entry.status = "timeout";
      } else if (entry.cancelled) {
        entry.status = "cancelled";
      } else {
        entry.status = "error";
      }
      entry.reject(err);
    } finally {
      entry.finishedAt = Date.now();
      this.running.delete(entry.id);
      this.emit("state", { id: entry.id, status: entry.status, label: entry.label });
      this._drain();
    }
  }

  enqueue(task, {
    label = "mlx",
    priority = 0,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    signal = null,
    id = randomUUID(),
  } = {}) {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    const controller = new AbortController();
    const entry = {
      id, label, priority,
      enqueuedAt: Date.now(),
      status: "queued",
      cancelled: false,
      cancelReason: null,
      task, controller,
      resolve, reject, promise,
    };

    // Dışarıdan abort: queued ise hemen sök, running ise controller.abort()
    const onExternalAbort = () => {
      entry.cancelled = true;
      entry.cancelReason = String(signal?.reason?.message || signal?.reason || "external abort");
      controller.abort(entry.cancelReason);
      const idx = this.pending.indexOf(entry);
      if (idx >= 0) {
        this.pending.splice(idx, 1);
        entry.status = "cancelled";
        reject(new Error(entry.cancelReason));
        this.emit("state", { id, status: "cancelled", label });
        this._drain();
      }
    };
    if (signal) {
      if (signal.aborted) { onExternalAbort(); return { id, promise }; }
      signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    // Max-wait timer: queued kaldığı sürece sayar; running'e geçince clear.
    const waitTimer = setTimeout(() => {
      if (entry.status !== "queued") return;
      const idx = this.pending.indexOf(entry);
      if (idx >= 0) this.pending.splice(idx, 1);
      entry.status = "timeout";
      controller.abort(new Error(`mlx-queue wait timeout ${maxWaitMs}ms`));
      reject(new Error(`mlx-queue wait timeout ${maxWaitMs}ms`));
      this.emit("state", { id, status: "timeout", label });
    }, maxWaitMs);
    promise.then(
      () => clearTimeout(waitTimer),
      () => clearTimeout(waitTimer),
    );

    this._insertSorted(entry);
    this.emit("state", { id, status: "queued", label, queueDepth: this.pending.length });
    this._drain();
    return { id, promise };
  }

  // Streaming wrapper: returns an async iterator whose underlying generator is
  // both STARTED and FULLY DRAINED inside the queue slot. The slot is held for
  // the entire stream lifetime, so `concurrency=1` really means "one MLX stream
  // at a time" — no second 72B stream can bind while this one is producing.
  //
  // Previous version resolved the slot as soon as the generator OBJECT was
  // created (generators don't run until iterated), so the real streaming work
  // happened OUTSIDE the slot → overlapping MLX streams → unified-memory blowup.
  //
  // Design: the in-slot producer pushes chunks into a tiny promise-based channel;
  // the out-of-slot consumer pulls from it. Client/timeout abort forwards into
  // the slot controller AND breaks the producer loop, so the upstream generator
  // is `.return()`-ed and the slot is released deterministically.
  enqueueStream(generatorFactory, opts = {}) {
    const queue = this;
    const externalSignal = opts.signal || null;

    const chunks = [];
    let finished = false;
    let failed = null;
    let aborted = false;
    let entryHandle = null;
    let resolveNext = null;

    const wake = () => {
      if (resolveNext) { const r = resolveNext; resolveNext = null; r(); }
    };
    const pushChunk = (c) => { chunks.push(c); wake(); };
    const finish = (err) => {
      if (finished) return;
      finished = true;
      if (err) failed = err;
      wake();
    };

    // Runs INSIDE the queue slot. Holds the slot until the generator is fully
    // drained (or aborts), guaranteeing single-flight streaming.
    const innerTask = async ({ signal }) => {
      let gen;
      try {
        gen = generatorFactory({ signal });
      } catch (e) {
        finish(e);
        return;
      }
      if (!gen || typeof gen[Symbol.asyncIterator] !== "function") {
        if (gen != null) pushChunk(gen);
        finish(null);
        return;
      }
      try {
        for await (const chunk of gen) {
          if (aborted || signal?.aborted) break;
          pushChunk(chunk);
        }
        finish(null);
      } catch (e) {
        finish(e);
      } finally {
        if (typeof gen.return === "function") {
          try { await gen.return(); } catch { /* noop */ }
        }
      }
    };

    entryHandle = queue.enqueue(innerTask, opts);
    // Surface enqueue-level failures (wait timeout, cancel) into the channel.
    entryHandle.promise.catch((e) => finish(e));

    if (externalSignal) {
      externalSignal.addEventListener("abort", () => {
        aborted = true;
        if (entryHandle?.id) queue.cancel(entryHandle.id, externalSignal.reason || "client abort");
        wake();
      }, { once: true });
    }

    async function* iterator() {
      while (true) {
        if (chunks.length) { yield chunks.shift(); continue; }
        if (finished) {
          if (failed) throw failed;
          return;
        }
        await new Promise((res) => { resolveNext = res; });
      }
    }

    return iterator();
  }


  cancel(id, reason = "cancelled") {
    // Running?
    const r = this.running.get(id);
    if (r) {
      r.cancelled = true;
      r.cancelReason = String(reason);
      r.controller.abort(reason);
      return true;
    }
    const idx = this.pending.findIndex(p => p.id === id);
    if (idx >= 0) {
      const p = this.pending[idx];
      this.pending.splice(idx, 1);
      p.cancelled = true;
      p.cancelReason = String(reason);
      p.status = "cancelled";
      p.reject(new Error(p.cancelReason));
      this.emit("state", { id, status: "cancelled", label: p.label });
      return true;
    }
    return false;
  }
}

// Single shared queue instance. Concurrency overridable via env.
export const localQueue = new MlxQueue();

// Convenience helper for simple awaitable tasks.
export function withMlxSlot(task, opts = {}) {
  return localQueue.enqueue(task, opts).promise;
}
