// Runtime ops: restart-runtime, runtime-sockets
// Extracted from server.mjs (Tur 2.2). Mutable state lives in RUNTIME_TRANSPORT
// (shared object reference) — no further hoisting needed.

export function mountSystemRoutes(app, deps) {
  const {
    listPortPids,
    listPortSockets,
    summarizeSocketStates,
    killPortOwnerAndWait,
    runtimeQueue,
    resetRuntimeKeepAliveAgent,
    restartLocalLlmRuntime,
    RUNTIME_TRANSPORT,
    runtimeUpstreamBase,
    runtimeModel,
    pushLog,
  } = deps;

  const RUNTIME_PORT_DEFAULT = Number(process.env.LOCAL_RUNTIME_PORT || 8001);

  function _activeRuntimePort() {
    try {
      const base = (typeof runtimeUpstreamBase === "function") ? runtimeUpstreamBase() : "";
      if (base) {
        const u = new URL(base);
        const p = Number(u.port || (u.protocol === "https:" ? 443 : 80));
        if (Number.isFinite(p) && p > 0) return p;
      }
    } catch {}
    return RUNTIME_PORT_DEFAULT;
  }

  app.post("/api/system/restart-runtime", async (_req, res) => {
    const RUNTIME_PORT = _activeRuntimePort();
    const steps = [];
    const traceId = `rst-${Date.now().toString(36)}`;
    try {
      const beforePids = listPortPids(RUNTIME_PORT);
      const beforeSockets = listPortSockets(RUNTIME_PORT);
      const beforeStates = summarizeSocketStates(beforeSockets);
      steps.push(`[${traceId}] before pids on :${RUNTIME_PORT} = [${beforePids.join(",") || "none"}] sockets=${JSON.stringify(beforeStates)}`);
      pushLog("server", `[runtime:restart:${traceId}] start · beforePids=[${beforePids.join(",") || "none"}] sockets=${Object.entries(beforeStates).map(([k,v])=>`${k}=${v}`).join(" ") || "none"}`);

      try {
        const st = runtimeQueue.stats?.() ?? {};
        const ids = [...(st.runningIds || []), ...(st.queuedIds || [])];
        for (const id of ids) { try { runtimeQueue.cancel(id, "runtime-restart"); } catch {} }
        steps.push(`queue cancelled (running=${st.running || 0} queued=${st.queued || 0})`);
      } catch {}

      await resetRuntimeKeepAliveAgent(`restart-${traceId}-pre`);
      steps.push("keep-alive tunnel closed (pre-kill)");

      const killed = await killPortOwnerAndWait(RUNTIME_PORT, 6000);
      steps.push(`port ${RUNTIME_PORT} cleaned (${killed} pid)`);

      await resetRuntimeKeepAliveAgent(`restart-${traceId}-post`);
      steps.push("keep-alive tunnel recreated (post-kill)");

      const activeBase = String((typeof runtimeUpstreamBase === "function" ? runtimeUpstreamBase() : "") || process.env.RUNTIME_BASE_URL || `http://127.0.0.1:${RUNTIME_PORT}`).replace(/\/+$/, "");
      const activeModel = typeof runtimeModel === "function" ? runtimeModel() : "";
      const rr = restartLocalLlmRuntime("operator-restart-runtime", { port: RUNTIME_PORT, base: activeBase, model: activeModel });
      if (rr.command) steps.push(`runtime restart dispatched (${rr.source || "command"}${rr.label ? ` · ${rr.label}` : ""}${rr.unit ? ` · ${rr.unit}` : ""})`);
      else if (rr.throttled) steps.push("restart command throttled (30s)");
      else steps.push("runtime restart command/service not discovered — manual runtime start required");

      const afterKillPids = listPortPids(RUNTIME_PORT);
      const afterKillSockets = listPortSockets(RUNTIME_PORT);
      const stillAlive = afterKillPids.filter((p) => beforePids.includes(p));
      steps.push(`afterKill pids=[${afterKillPids.join(",") || "none"}] stillAlive=[${stillAlive.join(",") || "none"}] sockets=${JSON.stringify(summarizeSocketStates(afterKillSockets))}`);

      RUNTIME_TRANSPORT.inflight = 0;
      RUNTIME_TRANSPORT.lastActivityAt = 0;
      RUNTIME_TRANSPORT.lastResetAt = Date.now();
      const realRestart = killed > 0 && stillAlive.length === 0;
      const restartCommandDispatched = !!rr.command;
      if (realRestart) {
        RUNTIME_TRANSPORT.dirty = false;
        RUNTIME_TRANSPORT.lastResetStatus = "restarted";
        RUNTIME_TRANSPORT.lastResetDetail = `[${traceId}] killed ${killed} pid on :${RUNTIME_PORT} · model reloading`;
        steps.push("transport state reset (dirty=false, inflight=0)");
      } else if (killed === 0 && beforePids.length === 0) {
        RUNTIME_TRANSPORT.dirty = !restartCommandDispatched;
        RUNTIME_TRANSPORT.lastResetStatus = restartCommandDispatched ? "respawn-requested" : "no-process";
        RUNTIME_TRANSPORT.lastResetDetail = restartCommandDispatched
          ? `[${traceId}] :${RUNTIME_PORT} boştu — runtime start komutu gönderildi`
          : `[${traceId}] :${RUNTIME_PORT} boştu — runtime service/command bulunamadı`;
        steps.push(restartCommandDispatched ? "no process was bound (runtime start requested)" : "no process was bound and no restart target was discovered");
      } else {
        RUNTIME_TRANSPORT.lastResetStatus = "restart-noop";
        RUNTIME_TRANSPORT.lastResetDetail = `[${traceId}] kill etkisiz — stillAlive=[${stillAlive.join(",")}] (dirty korunuyor)`;
        steps.push("restart-noop: zombi process hâlâ ayakta, dirty korunuyor");
        pushLog("server", `[runtime:restart:${traceId}] NOOP · stillAlive=[${stillAlive.join(",")}]`);
      }

      let back = false;
      let healthOk = false;
      let modelsOk = false;
      const base = activeBase;
      for (let i = 0; i < 20; i++) {
        const h = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
        if (h && h.ok) { back = true; healthOk = true; break; }
        const m = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
        if (m && m.ok) { back = true; modelsOk = true; break; }
        await new Promise((r) => setTimeout(r, 1000));
      }
      const afterPids = listPortPids(RUNTIME_PORT);
      const restartCleared = realRestart || (killed === 0 && beforePids.length === 0 && restartCommandDispatched);
      if (back && restartCleared) {
        RUNTIME_TRANSPORT.dirty = false;
        RUNTIME_TRANSPORT.lastResetStatus = "ready";
        RUNTIME_TRANSPORT.lastResetDetail = `[${traceId}] killed ${killed} · back online · pids=[${afterPids.join(",")}]`;
      } else if (back && !restartCleared) {
        RUNTIME_TRANSPORT.lastResetStatus = "restart-noop";
        RUNTIME_TRANSPORT.lastResetDetail = `[${traceId}] runtime responded but original pid survived — dirty korunuyor · pids=[${afterPids.join(",")}]`;
      }
      steps.push(`runtime port back=${back} health=${healthOk} models=${modelsOk} afterPids=[${afterPids.join(",") || "none"}]`);
      pushLog("server", `[runtime:restart:${traceId}] done · killed=${killed} realRestart=${realRestart} back=${back} afterPids=[${afterPids.join(",")}]`);

      const afterSockets = listPortSockets(RUNTIME_PORT);
      res.json({
        ok: true,
        traceId,
        killed,
        realRestart,
        back,
        healthOk,
        modelsOk,
        port: RUNTIME_PORT,
        beforePids,
        afterPids,
        stillAlive,
        status: RUNTIME_TRANSPORT.lastResetStatus,
        sockets: {
          before: beforeSockets,
          afterKill: afterKillSockets,
          after: afterSockets,
          afterStates: summarizeSocketStates(afterSockets),
        },
        steps,
      });
    } catch (e) {
      res.status(500).json({ ok: false, traceId, error: String(e?.message || e), steps });
    }
  });

  app.get("/api/system/runtime-sockets", (_req, res) => {
    try {
      const port = _activeRuntimePort();
      const sockets = listPortSockets(port);
      const counts = summarizeSocketStates(sockets);
      const hasListen = sockets.some(s => s.state === "LISTEN");
      const hasCloseWait = sockets.some(s => s.state === "CLOSE_WAIT");
      const remoteEstablished = sockets.filter(s => s.state === "ESTABLISHED" && s.remote && !/^127\.0\.0\.1[:.]/.test(s.remote));
      res.json({
        ok: true,
        port,
        counts,
        sockets,
        verdict: !hasListen
          ? "no_listener"
          : hasCloseWait
            ? "close_wait_present"
            : remoteEstablished.length > 0
              ? "remote_clients_attached"
              : "clean",
        transport: {
          inflight: RUNTIME_TRANSPORT.inflight,
          dirty: RUNTIME_TRANSPORT.dirty,
          lastResetStatus: RUNTIME_TRANSPORT.lastResetStatus,
          lastResetAt: RUNTIME_TRANSPORT.lastResetAt,
          lastFirstTokenTimeoutAt: RUNTIME_TRANSPORT.lastFirstTokenTimeoutAt,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
