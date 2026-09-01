// MLX Transport Module
// -----------------------------------------------------------------------------
// Kırılım 1 (2026-05-30): Skeleton.
// Kırılım 2a (2026-05-30): LOCAL_TRANSPORT state objesi + getLocalTransportSnapshot()
//   reader'ı buraya taşındı. server.mjs hem objeyi import edip mutate eder
//   (recordMlxAbort, triggerMlxZombieSelfHeal, fetch hot-path), hem snapshot'ı
//   UI endpoint'lerine basar.
//
// Yol haritası: mem://decisions/mlx-transport-modularization-2026-05-30.md
// Pre-state anchor:  mem://session/2026-05-30-mlx-transport-break-0.md
// Bu kırılım anchor: mem://session/2026-05-30-mlx-transport-break-2a.md
//
// SCOPE — bu dosyaya SADECE MLX upstream transport hattı taşınır:
//   ✓ Kırılım 1: skeleton
//   ✓ Kırılım 2a: state container + snapshot reader (leaf, davranış aynı)
//   ☐ Kırılım 2b: fetch + AbortController + watchdog (streamMlxCompletion)
//   ☐ Kırılım 3: state machine (8 state) + dirty/inflight invariants
//   ☐ Kırılım 4: zombie self-heal merged
//   ☐ Kırılım 5: /api/chat/orchestrate de bu modülü kullanır
//
// SCOPE DIŞI: RAG, prompt build, agent dispatch, UI, queue policy.
// -----------------------------------------------------------------------------
import os from "node:os";

export const RUNTIME_TRANSPORT_MODULE_VERSION = "0.5.0-agnostic";

// Backward-compat shim: older extracted warmup code briefly imported this name
// from mlx-transport. The real keep-alive dispatcher is owned by server.mjs and
// passed to warmup via DI; exporting undefined here prevents stale ESM consumers
// from crashing during rolling restarts.
export const MLX_KEEPALIVE_AGENT = undefined;

/**
 * MLX upstream transport durumu. Tek bir global object — server.mjs sıcak
 * yoldaki mutasyonları (inflight++, dirty=true, lastActivityAt=Date.now()) bu
 * imported referans üzerinden yapar. Const object property mutation güvenli;
 * referansın kendisi tek instance kalır.
 *
 * Alanların kullanım haritası (Kırılım 2b+ taşınacak):
 *   keepAlive            — transport snapshot UI'ı (raporlama)
 *   resetEnabled/resetUrl — legacy MLX_RESET_URL hattı (kullanım: prewarm gate)
 *   inflight             — eş zamanlı MLX upstream sayacı (++ fetch öncesi, -- finally)
 *   dirty                — first-token timeout sonrası "şüpheli slot" işareti
 *   lastActivityAt       — başarılı first-token zaman damgası (warm signal)
 *   lastFirstTokenTimeoutAt — son zombi şüphesi (cold pre-warm bastırma)
 *   lastAbortAt/Reason   — son abort kaydı (UI + diag log)
 *   lastSelfHeal*        — self-heal cooldown + son sonuç
 *   lastReset*           — legacy /reset call sonucu
 *   heartbeat*           — opt-in idle keep-warm (default off)
 *   hf/transformersOffline — boot anındaki HF env snapshot (UI rapor)
 */
export const RUNTIME_TRANSPORT = {
  keepAlive: true,
  lastAbortAt: 0,
  lastAbortReason: "",
  inflight: 0,
  lastActivityAt: 0,
  hfOffline: String(process.env.HF_HUB_OFFLINE || "") === "1",
  transformersOffline: String(process.env.TRANSFORMERS_OFFLINE || "") === "1",
  hfDatasetsOffline: String(process.env.HF_DATASETS_OFFLINE || "") === "1",
};

/**
 * Kırılım 3 (2026-05-30) — Derived state machine.
 *
 * LOCAL_TRANSPORT alanlarından tek bir etiket türetir. ADDITIVE: mevcut
 * mutation hat ve karar akışı dokunulmaz; bu fonksiyon sadece UI/log/snapshot
 * için coherent bir state label döner. Kırılım 4'te zombie self-heal
 * kararı bu state üzerine oturacak.
 *
 * State öncelik sırası (yukarıdan aşağıya, ilk eşleşen kazanır):
 *   restarting — self-heal başlatılmış ve cooldown içinde
 *   dirty      — first-token timeout sonrası şüpheli slot (dirty flag)
 *   serving    — inflight > 0 (aktif upstream akış)
 *   warm       — warmTtlMs içinde başarılı first-token kaydı var
 *   idle       — yukarıdakilerin hiçbiri (cold/boş)
 *
 * @param {object}   opts
 * @param {number}  [opts.warmTtlMs] — caller (server.mjs) `_localWarmCacheTtlMs()` değerini geçer.
 *                                      Varsayılan 600_000 (10dk) — env/UI fallback.
 * @param {number}  [opts.now]       — test edilebilirlik için clock override.
 * @returns {"restarting"|"dirty"|"serving"|"warm"|"idle"}
 */
export function getRuntimeState({ warmTtlMs, now } = {}) {
  const t = typeof now === "number" ? now : Date.now();
  const ttl = Number.isFinite(warmTtlMs) && warmTtlMs > 0 ? warmTtlMs : 600_000;
  if ((RUNTIME_TRANSPORT.inflight || 0) > 0) return "serving";
  const lastAct = RUNTIME_TRANSPORT.lastActivityAt || 0;
  if (lastAct > 0 && (t - lastAct) < ttl) return "warm";
  return "idle";
}

/**
 * UI / debug endpoint'leri için sığ kopya.
 */
export function getRuntimeTransportSnapshot(opts = {}) {
  return Object.freeze({
    ...RUNTIME_TRANSPORT,
    state: getRuntimeState(opts),
  });
}

/**
 * MLX upstream chat-completions fetch hattı (Kırılım 2b, 2026-05-30).
 *
 * server.mjs sıcak yolundaki ~115 satırlık fetch + AbortController + headers
 * timeout + warming-notice + reader + first-token/idle-delta watchdog + clean-
 * vs-dirty cancel + finally inflight decrement bloğu BURADA. Pre-warm gate,
 * payload build, policy merge, _safety çözümleme ve render seçimi HALA
 * server.mjs'te kalır; bu generator sadece çağrılır.
 *
 * Davranış değişmez — kod yeri değişir. Çağıran tarafta
 * `yield* streamMlxCompletion({...})` şeklinde kullanılır. Tüm bağımlılıklar
 * (pushLog, runtimeFetchError, recordMlxAbort, drainChatDeltaBuffer) param
 * olarak geçer — bu modül server.mjs'ten import etmez (circular dep yok).
 */
export async function* streamRuntimeCompletion({
  // request
  target,
  payload,
  timeoutSignal,
  // budgets
  headersTimeoutMs,
  firstTokenTimeoutMs,
  idleDeltaTimeoutMs,
  warmingNoticeMs,
  // context
  modelLabel,
  intentHint,
  promptSysLen,
  publicBase,
  base,
  onWarming,
  onLoopGuard,
  loopGuard,
  // deps
  pushLog,
  runtimeFetchError,
  recordRuntimeAbort,
  drainChatDeltaBuffer,
}) {
  let r;
  const headersCtrl = new AbortController();
  const relayAbort = () => headersCtrl.abort(timeoutSignal?.reason || new Error("client aborted"));
  if (timeoutSignal) timeoutSignal.addEventListener("abort", relayAbort, { once: true });
  const headersTimer = setTimeout(() => headersCtrl.abort(new Error(`Runtime headers timeout after ${headersTimeoutMs}ms`)), headersTimeoutMs);
  let warmingTimer = null;
  if (typeof onWarming === "function") {
    warmingTimer = setTimeout(() => {
      try { onWarming({ headersTimeoutMs, firstTokenTimeoutMs }); } catch {}
    }, warmingNoticeMs);
  }
  let reader = null;
  let cancelReader = null;
  let onUpstreamAbort = null;
  let streamFinished = false;
  RUNTIME_TRANSPORT.inflight += 1;
  try {
    try {
      r = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Connection": "close" },
        body: JSON.stringify(payload),
        signal: headersCtrl.signal,
      });
    } catch (e) {
      const detail = runtimeFetchError(e, { provider: "Runtime", target, publicBase, upstreamBase: base, model: modelLabel, phase: "stream" });
      console.error(detail); pushLog("server", detail);
      recordRuntimeAbort(`headers: ${detail}`);
      const err = new Error(detail);
      err.code = /timeout|abort/i.test(detail) ? "RUNTIME_BUSY" : "RUNTIME_FAIL";
      throw err;
    } finally {
      clearTimeout(headersTimer);
      if (warmingTimer) clearTimeout(warmingTimer);
      if (timeoutSignal) timeoutSignal.removeEventListener("abort", relayAbort);
    }
    if (!r.ok || !r.body) {
      const detail = await r.text().catch(() => "");
      console.error(`Runtime Connection Error: ${target} -> HTTP ${r.status} ${r.statusText} ${detail}`);
      throw new Error(`Runtime Connection Error: HTTP ${r.status} ${r.statusText}${detail ? ` · ${detail}` : ""}`);
    }
    reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let sawFirstToken = false;
    let lastDeltaAt = Date.now();
    cancelReader = (why) => {
      const raw = String(why?.message || why || "cancel");
      const isClean = raw === "done" || /stream.*finalize/i.test(raw) || /^reader_finalize$/i.test(raw);
      if (isClean) return;
      try { Promise.resolve(reader?.cancel?.(why)).catch(() => {}); } catch {}
      try { Promise.resolve(r.body?.cancel?.(why)).catch(() => {}); } catch {}
      let category = "unknown";
      if (/first-?token timeout/i.test(raw)) category = "first_token_timeout";
      else if (/idle delta timeout/i.test(raw)) category = "idle_delta_timeout";
      else if (/headers timeout/i.test(raw)) category = "headers_timeout";
      else if (/client.*aborted/i.test(raw)) category = "client_aborted";
      else if (/timeout/i.test(raw)) category = "stream_total_timeout";
      pushLog("server", `[runtime:abort] category=${category} model=${modelLabel} intent=${intentHint} promptChars=${promptSysLen} budgetMs(first=${firstTokenTimeoutMs},idle=${idleDeltaTimeoutMs},headers=${headersTimeoutMs}) raw="${raw.slice(0, 200)}"`);
      recordRuntimeAbort(`${raw} · target=${target} · base=${base || publicBase || ""}`);
    };
    onUpstreamAbort = () => {
      if (streamFinished) return;
      cancelReader(timeoutSignal?.reason || new Error("client/timeout aborted"));
    };
    if (timeoutSignal && !timeoutSignal.aborted) timeoutSignal.addEventListener("abort", onUpstreamAbort, { once: true });
    const readWithTimeout = () => {
      const cap = sawFirstToken ? idleDeltaTimeoutMs : firstTokenTimeoutMs;
      let timer = null;
      const timeoutP = new Promise((_, rej) => {
        timer = setTimeout(() => {
          const label = sawFirstToken ? `Runtime idle delta timeout after ${cap}ms` : `Runtime first-token timeout after ${cap}ms`;
          const err = new Error(label);
          err.code = sawFirstToken ? "RUNTIME_IDLE_DELTA_TIMEOUT" : "RUNTIME_FIRST_TOKEN_TIMEOUT";
          rej(err);
        }, cap);
      });
      return Promise.race([reader.read(), timeoutP]).finally(() => {
        if (timer) { clearTimeout(timer); timer = null; }
      });
    };
    const _guardOn = !!(loopGuard && loopGuard.enabled === true);
    const _gLineMin    = Math.max(2, Number(loopGuard?.lineMin)    || 6);
    const _gLineMaxLen = Math.max(20, Number(loopGuard?.lineMaxLen) || 80);
    const _gPhraseMin  = Math.max(2, Number(loopGuard?.phraseMin)  || 5);
    const _gMinTokens  = Math.max(0, Number(loopGuard?.minTokens)  || 200);
    const _gSubstrWin    = Math.max(8, Number(loopGuard?.substrWin)    || 24);
    const _gSubstrRepeat = Math.max(3, Number(loopGuard?.substrRepeat) || 6);
    let _accumChars = 0;
    let _accumText  = "";
    let _substrTail = "";
    let _lastLine = "";
    let _lastLineCount = 0;
    let _lastPhrase = "";
    let _lastPhraseCount = 0;
    let _guardTripped = null;
    const _checkGuard = (delta) => {
      if (!_guardOn) return;
      _accumChars += delta.length;
      if (_accumChars < _gMinTokens) return;
      _accumText += delta;
      const nlIdx = _accumText.lastIndexOf("\n");
      if (nlIdx > -1) {
        const finished = _accumText.slice(0, nlIdx).split("\n");
        _accumText = _accumText.slice(nlIdx + 1);
        for (const raw of finished) {
          const line = raw.trim();
          if (!line || line.length > _gLineMaxLen) { _lastLine = ""; _lastLineCount = 0; continue; }
          if (line === _lastLine) {
            _lastLineCount += 1;
            if (_lastLineCount >= _gLineMin) {
              _guardTripped = { reason: "repeated_line", sample: line.slice(0, 120), count: _lastLineCount };
              return;
            }
          } else {
            _lastLine = line; _lastLineCount = 1;
          }
        }
      }
      const tail = (_accumText || "").slice(-2000);
      const sentences = tail.split(/[.!?]+\s+/).map(s => s.trim()).filter(s => s.length >= 12 && s.length <= 200);
      if (sentences.length >= 2) {
        const last = sentences[sentences.length - 1];
        if (last === _lastPhrase) {
          _lastPhraseCount += 1;
          if (_lastPhraseCount >= _gPhraseMin) {
            _guardTripped = { reason: "repeated_phrase", sample: last.slice(0, 160), count: _lastPhraseCount };
          }
        } else {
          _lastPhrase = last; _lastPhraseCount = 1;
        }
      }
      if (_guardTripped) return;
      const _tailCap = _gSubstrWin * (_gSubstrRepeat + 2);
      _substrTail = (_substrTail + delta).slice(-_tailCap);
      if (_substrTail.length >= _gSubstrWin * _gSubstrRepeat) {
        const needle = _substrTail.slice(-_gSubstrWin);
        const trimmed = needle.trim();
        if (trimmed.length >= Math.max(4, Math.floor(_gSubstrWin / 3))) {
          let count = 0;
          let idx = 0;
          while ((idx = _substrTail.indexOf(needle, idx)) !== -1) {
            count += 1;
            idx += _gSubstrWin;
            if (count >= _gSubstrRepeat) break;
          }
          if (count >= _gSubstrRepeat) {
            _guardTripped = {
              reason: "repeated_substring",
              sample: needle.replace(/\\s+/g, " ").slice(0, 120),
              count,
            };
          }
        }
      }
    };
    try {
      while (true) {
        const { value, done } = await readWithTimeout();
        if (done) { streamFinished = true; break; }
        buf += dec.decode(value, { stream: true });
        const drained = drainChatDeltaBuffer(buf);
        buf = drained.rest;
        for (const piece of drained.pieces) {
          sawFirstToken = true; lastDeltaAt = Date.now();
          yield piece;
          if (_guardOn) {
            _checkGuard(piece);
            if (_guardTripped) {
              try { pushLog("server", `[runtime:loop_guard] tripped reason=${_guardTripped.reason} count=${_guardTripped.count} model=${modelLabel} sample="${_guardTripped.sample.replace(/\"/g, "'")}"`); } catch {}
              try { if (typeof onLoopGuard === "function") onLoopGuard({ ..._guardTripped, model: modelLabel }); } catch {}
              try { recordRuntimeAbort(`loop_guard:${_guardTripped.reason}`); } catch {}
              streamFinished = true;
              return;
            }
          }
        }
        if (drained.done) { streamFinished = true; return; }
      }
    } catch (e) {
      cancelReader(e);
      throw e;
    }
  } finally {
    if (timeoutSignal && onUpstreamAbort) timeoutSignal.removeEventListener("abort", onUpstreamAbort);
    if (reader && !streamFinished && typeof cancelReader === "function") cancelReader("runtime-stream-finalize");
    RUNTIME_TRANSPORT.inflight = Math.max(0, RUNTIME_TRANSPORT.inflight - 1);
  }
}

// -----------------------------------------------------------------------------
// End of Transport Module
// -----------------------------------------------------------------------------

export function recordRuntimeActivity() {
  RUNTIME_TRANSPORT.lastActivityAt = Date.now();
}

export default {
  version: RUNTIME_TRANSPORT_MODULE_VERSION,
  RUNTIME_TRANSPORT,
  getRuntimeTransportSnapshot,
  getRuntimeState,
  streamRuntimeCompletion,
};
