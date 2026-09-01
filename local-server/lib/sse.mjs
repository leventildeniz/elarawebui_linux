// local-server/lib/sse.mjs
// SSE wire helpers — extracted from server.mjs (block 1229-1310).
// Pure utilities: no DB, no module state. Operate purely on Node req/res.
//
// Hot-path notes:
// - setNoDelay disables Nagle; without it the kernel can hold a 30–40 ms
//   slice per chunk → token stream feels laggy on long answers.
// - flushSse() pumps res.flush + flushHeaders + socket.uncork; SSE wants
//   sub-millisecond frame delivery.
// - sseBegin() returns a closed-aware writer with send/sendNamed/keepAlive/
//   close. `closed` flag stays sticky after req aborted or res close;
//   IMPORTANT: req.close on POST fires when the request body is fully
//   consumed even while the SSE response is alive — only `aborted` and
//   res `close` mark the stream dead.

export function corsHeadersFor(req) {
  const origin = String(req?.headers?.origin || "").trim();
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": String(req?.headers?.["access-control-request-headers"] || "Content-Type, Authorization, Accept, Origin, X-Requested-With, X-User, x-user, X-Session-Id, x-session-id, X-User-Role, x-user-role, Access-Control-Request-Private-Network"),
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Expose-Headers": "Content-Type, Content-Length, Access-Control-Allow-Private-Network",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers, Access-Control-Request-Private-Network",
  };
}

export function flushSse(res) {
  try { res.flush?.(); } catch {}
  try { res.flushHeaders?.(); } catch {}
  try { res.socket?.uncork?.(); } catch {}
}

export function sseWrite(res, chunk) {
  if (!res || res.destroyed || res.writableEnded) return false;
  try {
    const ok = res.write(chunk);
    flushSse(res);
    return ok;
  } catch {
    return false;
  }
}

export function sseBegin(req, res, { hello } = {}) {
  let closed = false;
  let draining = false;
  const markClosed = () => { closed = true; };
  // IMPORTANT: On Node.js, `req.close` on a POST can fire when the request body
  // has merely been fully consumed, while the SSE response is still alive. If we
  // mark the stream closed there, the accepted/bypass frames reach the browser
  // but the delta + final close are silently dropped, leaving the UI spinning.
  req.on("aborted", markClosed);
  res.on("close", markClosed);
  const writeRaw = (chunk) => {
    if (closed || res.destroyed || res.writableEnded) return false;
    try {
      const ok = sseWrite(res, chunk);
      if (!ok && !draining) {
        draining = true;
        res.once("drain", () => { draining = false; flushSse(res); });
      }
      return true;
    } catch {
      closed = true;
      return false;
    }
  };
  res.writeHead(200, {
    ...corsHeadersFor(req),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Content-Encoding": "identity",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Stream-Flush": "immediate",
  });
  try {
    req.socket?.setNoDelay?.(true);
    req.socket?.setKeepAlive?.(true, 30_000);
    req.socket?.setTimeout?.(0);
  } catch {}
  flushSse(res);
  if (hello) writeRaw(`data: ${JSON.stringify(hello)}\n\n`);
  return {
    send: (obj) => writeRaw(`data: ${JSON.stringify(obj)}\n\n`),
    sendNamed: (event, data) => writeRaw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    keepAlive: () => writeRaw(`: keep-alive ${Date.now()}\n\n`),
    close: (final) => {
      if (closed || res.destroyed || res.writableEnded) return;
      if (final !== undefined) writeRaw(`data: ${typeof final === "string" ? final : JSON.stringify(final)}\n\n`);
      try { flushSse(res); res.end(); } catch {}
      closed = true;
    },
    raw: res,
    isClosed: () => closed || res.destroyed || res.writableEnded,
  };
}
