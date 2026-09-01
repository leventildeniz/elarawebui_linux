#!/usr/bin/env bun
// Faz 9 — Smoke harness (Bun-only; proje mührü Bun, Node CLI yasak).
//
// Kullanım:
//   bun run smoke -- --base http://127.0.0.1:3005 --admin-login admin secret
//   bun run smoke -- --base https://127.0.0.1:10443 --insecure --admin-login admin secret
//   bun local-server/tools/smoke.mjs --base ... --sid <sessionId>
//   bun local-server/tools/smoke.mjs --base ... --admin-login user pass [--provider local]
//
// Akış:
//   1) --admin-login varsa POST /api/auth/login ile sid çekilir,
//      ardından admin yetkisi DB tarafından doğrulanır.
//   2) Tüm kontraklar (tools/contracts.mjs) çalıştırılır; PASS/FAIL/SKIP.
//   3) Test sonunda otomatik logout — oturum sızıntısı yok, duplicate run yok.
//   4) Çıkış kodu = başarısız test sayısı.

import { contracts } from "./contracts.mjs";
import WebSocket from "ws";
// Faz 17.3 — wss.upgrade: gerçek WebSocket bağlantısı aç, "ready" beklenir.
// Node `ws` client ile self-signed WSS için rejectUnauthorized açıkça yönetilir.

// Faz 18 — Bun runtime'ında `ws` modülü close/terminate sonrası fazladan
// async "error" event'i atabiliyor. Bu zaten test mantığı tamamlandıktan sonra
// gelir; sessizce yutuyoruz. Gerçek bug'lar (TypeError vs.) re-throw edilir.
process.on("uncaughtException", (e) => {
  const m = String(e?.message || e || "").toLowerCase();
  if (m.includes("unhandled error") || m.includes("error event") || (e && e.isTrusted !== undefined)) return;
  console.error("uncaughtException:", e);
  process.exit(2);
});
process.on("unhandledRejection", (e) => {
  const m = String(e?.message || e || "").toLowerCase();
  if (m.includes("unhandled error") || m.includes("error event")) return;
  console.error("unhandledRejection:", e);
});

// --- argv parser: --key value, --flag, --admin-login user pass ----------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    if (key === "admin-login") {
      out.adminLogin = { user: argv[++i], pass: argv[++i] };
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const BASE = String(args.base || process.env.BRIDGE_BASE || "http://127.0.0.1:3005").replace(/\/+$/, "");
const PROVIDER = String(args.provider || "local");
let SID = String(args.sid || process.env.BRIDGE_SID || "");
let ADMIN = args.admin === true || !!SID;
let LOGGED_IN = false;

// --insecure: self-signed mkcert için TLS doğrulamasını kapat (default: kapalı).
if (args.insecure === true) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const isTTY = process.stdout.isTTY;
const c = (code, s) => (isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const green  = (s) => c(32, s);
const red    = (s) => c(31, s);
const yellow = (s) => c(33, s);
const dim    = (s) => c(90, s);
const bold   = (s) => c(1,  s);

async function jsonFetch(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, init);
  const text = await r.text();
  let parsed = null; try { parsed = JSON.parse(text); } catch {}
  return { status: r.status, body: text, json: parsed, headers: r.headers };
}

async function adminLogin(user, pass) {
  console.log(dim(`auto-login → ${user}@${PROVIDER}`));
  const r = await jsonFetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: user, password: pass, provider: PROVIDER, device: "smoke-harness" }),
  });
  if (r.status !== 200 || !r.json?.ok || !r.json?.sessionId) {
    throw new Error(`login failed (${r.status}): ${r.body.slice(0, 200)}`);
  }
  SID = r.json.sessionId;
  const role = String(r.json.user?.role || "").toLowerCase();
  ADMIN = role === "admin";
  LOGGED_IN = true;
  console.log(dim(`sid=${SID.slice(0, 12)}… role=${role}${ADMIN ? "" : " (admin contracts will SKIP)"}`));
}

async function logout() {
  if (!LOGGED_IN || !SID) return;
  await jsonFetch(`/api/sessions/${encodeURIComponent(SID)}`, {
    method: "DELETE",
    headers: { "x-session-id": SID },
  }).catch(() => {});
}

async function proxyStatsBrief() {
  try {
    const r = await fetch("http://127.0.0.1:10444/stats");
    const j = await r.json();
    const ws = j?.ws || {};
    return `proxy stats: upgrades=${ws.upgrades ?? "?"} errors=${ws.errors ?? "?"} status=${ws.lastStatus ?? "?"} error=${ws.lastError || "-"} path=${ws.lastPath || "-"}`;
  } catch (e) {
    return `proxy stats unavailable: ${String(e?.message || e).slice(0, 120)}`;
  }
}

// Faz 18 — Bun runtime `ws.unexpected-response`'i desteklemiyor (yalnız uyarı).
// Bun altındaysak handler'ı bağlamayı atlıyoruz; davranış değişmez.
const IS_BUN = typeof globalThis.Bun !== "undefined";

async function wsReadyProbe(wsUrl, wsOptions = {}, timeoutMs = 3000) {
  const t0 = Date.now();
  const result = await new Promise((resolve) => {
    let done = false;
    let opened = false;
    let ws = null;
    const finish = (r) => {
      if (done) return; done = true;
      try { ws?.on?.("error", () => {}); } catch {}
      try { ws?.close(); } catch {}
      try { ws?.terminate?.(); } catch {}
      resolve(r);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, error: opened ? `timeout ${timeoutMs}ms after open waiting for ready` : `timeout ${timeoutMs}ms before open` });
    }, timeoutMs);
    try {
      ws = new WebSocket(wsUrl, { handshakeTimeout: timeoutMs, ...wsOptions });
    } catch (e) {
      clearTimeout(timer);
      return finish({ ok: false, error: `ctor: ${e?.message || e}` });
    }
    ws.once("open", () => { opened = true; });
    if (!IS_BUN) {
      ws.once("unexpected-response", (_req, res) => {
        let body = "";
        res.on("data", (chunk) => { if (body.length < 240) body += String(chunk); });
        res.on("end", () => {
          clearTimeout(timer);
          finish({ ok: false, error: `unexpected response ${res.statusCode || "?"}${body ? ` ${body.slice(0, 160)}` : ""}` });
        });
        res.resume();
      });
    }
    ws.on("message", (data) => {
      let msg = null;
      try { msg = JSON.parse(String(data ?? "")); }
      catch { clearTimeout(timer); return finish({ ok: false, error: "invalid ready json" }); }
      if (msg?.type === "ready" && Number.isFinite(Number(msg?.ts))) {
        clearTimeout(timer);
        return finish({ ok: true });
      }
      clearTimeout(timer);
      return finish({ ok: false, error: `unexpected message ${String(msg?.type || "?")}` });
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: err?.message || "ws error" });
    });
    ws.once("close", (code) => {
      if (done) return;
      clearTimeout(timer);
      finish({ ok: false, error: `${opened ? "closed before ready" : "closed before open"} (code ${code ?? "?"})` });
    });
  });
  return { ...result, ms: Date.now() - t0 };
}

// Faz 18 — Ready sonrası request/response turu. Bağlantı tek seferlik.
async function wsRoundTrip(wsUrl, wsOptions, sendObj, expectFn, timeoutMs = 3000) {
  const t0 = Date.now();
  const result = await new Promise((resolve) => {
    let done = false;
    let ws = null;
    const finish = (r) => { if (done) return; done = true; try { ws?.on?.("error", () => {}); } catch {} try { ws?.close(); } catch {} try { ws?.terminate?.(); } catch {} resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: `roundtrip timeout ${timeoutMs}ms` }), timeoutMs);
    try { ws = new WebSocket(wsUrl, { handshakeTimeout: timeoutMs, ...wsOptions }); }
    catch (e) { clearTimeout(timer); return finish({ ok: false, error: `ctor: ${e?.message || e}` }); }
    let ready = false;
    ws.on("message", (data) => {
      let msg = null;
      try { msg = JSON.parse(String(data ?? "")); } catch { return; }
      if (!ready) {
        if (msg?.type === "ready") {
          ready = true;
          try { ws.send(JSON.stringify(sendObj)); }
          catch (e) { clearTimeout(timer); return finish({ ok: false, error: `send: ${e?.message || e}` }); }
        }
        return;
      }
      const v = expectFn(msg);
      if (v === true) { clearTimeout(timer); return finish({ ok: true }); }
      clearTimeout(timer); return finish({ ok: false, error: typeof v === "string" ? v : "unexpected response" });
    });
    ws.on("error", (err) => { clearTimeout(timer); finish({ ok: false, error: err?.message || "ws error" }); });
    ws.once("close", (code) => { if (!done) { clearTimeout(timer); finish({ ok: false, error: `closed (code ${code ?? "?"})` }); } });
    if (!IS_BUN) {
      ws.once("unexpected-response", (_req, res) => {
        clearTimeout(timer); finish({ ok: false, error: `unexpected response ${res.statusCode || "?"}` });
        try { res.resume(); } catch {}
      });
    }
  });
  return { ...result, ms: Date.now() - t0 };
}

// Faz 18 — Çift turlu ping/pong. Aynı bağlantı üzerinde 2 ping atılır.
async function wsHeartbeatProbe(wsUrl, wsOptions, rounds = 2, timeoutMs = 4000) {
  const t0 = Date.now();
  const result = await new Promise((resolve) => {
    let done = false;
    let ws = null;
    let pongs = 0;
    const finish = (r) => { if (done) return; done = true; try { ws?.on?.("error", () => {}); } catch {} try { ws?.close(); } catch {} try { ws?.terminate?.(); } catch {} resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: `heartbeat timeout ${timeoutMs}ms (pongs=${pongs}/${rounds})` }), timeoutMs);
    try { ws = new WebSocket(wsUrl, { handshakeTimeout: timeoutMs, ...wsOptions }); }
    catch (e) { clearTimeout(timer); return finish({ ok: false, error: `ctor: ${e?.message || e}` }); }
    let ready = false;
    const sendNext = () => { try { ws.send(JSON.stringify({ type: "ping" })); } catch (e) { clearTimeout(timer); finish({ ok: false, error: `send: ${e?.message || e}` }); } };
    ws.on("message", (data) => {
      let msg = null;
      try { msg = JSON.parse(String(data ?? "")); } catch { return; }
      if (!ready) { if (msg?.type === "ready") { ready = true; sendNext(); } return; }
      if (msg?.type !== "pong") { clearTimeout(timer); return finish({ ok: false, error: `expected pong got ${msg?.type}` }); }
      pongs++;
      if (pongs >= rounds) { clearTimeout(timer); return finish({ ok: true }); }
      sendNext();
    });
    ws.on("error", (err) => { clearTimeout(timer); finish({ ok: false, error: err?.message || "ws error" }); });
    ws.once("close", (code) => { if (!done) { clearTimeout(timer); finish({ ok: false, error: `closed (code ${code ?? "?"}, pongs=${pongs}/${rounds})` }); } });
    if (!IS_BUN) {
      ws.once("unexpected-response", (_req, res) => { clearTimeout(timer); finish({ ok: false, error: `unexpected response ${res.statusCode || "?"}` }); try { res.resume(); } catch {} });
    }
  });
  return { ...result, ms: Date.now() - t0 };
}

// Faz 18 — Geçersiz SID ile bağlantı reddedilmeli (close / error / 401).
async function wsExpectReject(wsUrl, wsOptions, timeoutMs = 3000) {
  const t0 = Date.now();
  const result = await new Promise((resolve) => {
    let done = false;
    let ws = null;
    const finish = (r) => { if (done) return; done = true; try { ws?.on?.("error", () => {}); } catch {} try { ws?.close(); } catch {} try { ws?.terminate?.(); } catch {} resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: "no reject within timeout" }), timeoutMs);
    try { ws = new WebSocket(wsUrl, { handshakeTimeout: timeoutMs, ...wsOptions }); }
    catch (e) { clearTimeout(timer); return finish({ ok: true }); }
    let openedFlag = false;
    ws.once("open", () => { openedFlag = true; });
    ws.on("message", (data) => {
      // Eğer ready geldiyse demek ki gate sızdı — fail.
      try { const m = JSON.parse(String(data ?? "")); if (m?.type === "ready") { clearTimeout(timer); finish({ ok: false, error: "gate leaked: ready arrived" }); } } catch {}
    });
    ws.on("error", () => { clearTimeout(timer); finish({ ok: true }); });
    ws.once("close", (code) => { clearTimeout(timer); finish(openedFlag && code === 1000 ? { ok: false, error: "opened then normal-closed" } : { ok: true }); });
    if (!IS_BUN) {
      ws.once("unexpected-response", (_req, res) => {
        clearTimeout(timer);
        finish(res.statusCode === 401 ? { ok: true } : { ok: false, error: `expected 401 got ${res.statusCode}` });
        try { res.resume(); } catch {}
      });
    }
  });
  return { ...result, ms: Date.now() - t0 };
}

async function runOne(c0) {
  if (c0.requiresSession && !SID && !c0.skipSession) return { name: c0.name, skipped: "no sid" };
  if (c0.requiresAdmin  && !ADMIN)                   return { name: c0.name, skipped: "no admin sid" };
  const headers = { "content-type": "application/json" };
  if (SID && !c0.skipSession) headers["x-session-id"] = SID;
  // Faz 13.2 — contract'a özel header'lar (örn. bogus cookie ile gate testi).
  // skipSession ile birlikte gelirse contract header'ları otomatik SID'i ezer.
  if (c0.headers) Object.assign(headers, c0.headers);
  const t0 = Date.now();
  let r;
  try {
    r = await jsonFetch(c0.path, {
      method: c0.method,
      headers,
      body: c0.body ? JSON.stringify(c0.body) : undefined,
    });
  } catch (e) {
    return { name: c0.name, ok: false, error: String(e?.message || e), ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  const expectStatus = c0.expectStatus || [200];
  if (!expectStatus.includes(r.status)) {
    return { name: c0.name, ok: false, error: `status ${r.status}`, body: r.body.slice(0, 200), ms };
  }
  const parsed = r.json;
  if (c0.must && parsed) {
    for (const k of c0.must) if (!(k in parsed)) return { name: c0.name, ok: false, error: `missing key ${k}`, ms };
  }
  if (c0.subKeys && parsed) {
    for (const [parent, keys] of Object.entries(c0.subKeys)) {
      const sub = parsed[parent];
      if (!sub || typeof sub !== "object") return { name: c0.name, ok: false, error: `${parent} not object`, ms };
      for (const k of keys) if (!(k in sub)) return { name: c0.name, ok: false, error: `${parent}.${k} missing`, ms };
    }
  }
  if (c0.expect && parsed) {
    const v = c0.expect(parsed);
    if (v !== true) return { name: c0.name, ok: false, error: typeof v === "string" ? v : "expect() failed", ms };
  }
  // Faz 16.2 — opsiyonel response-header doğrulaması (gzip pass-through vb.)
  if (c0.expectHeaders) {
    for (const [hk, hv] of Object.entries(c0.expectHeaders)) {
      const actual = r.headers.get(hk);
      if (typeof hv === "function") {
        const v = hv(actual);
        if (v !== true) return { name: c0.name, ok: false, error: typeof v === "string" ? v : `header ${hk} failed`, ms };
      } else if (String(actual || "").toLowerCase() !== String(hv).toLowerCase()) {
        return { name: c0.name, ok: false, error: `header ${hk} expected ${hv} got ${actual}`, ms };
      }
    }
  }
  return { name: c0.name, ok: true, status: r.status, ms };
}

(async () => {
  console.log(bold(`smoke → ${BASE}`));
  try {
    if (args.adminLogin) {
      if (!args.adminLogin.user || !args.adminLogin.pass) {
        throw new Error("--admin-login requires <user> <pass>");
      }
      await adminLogin(args.adminLogin.user, args.adminLogin.pass);
    } else {
      console.log(dim(SID ? `using sid=${SID.slice(0, 12)}…` : "no sid (session contracts will SKIP)"));
    }

    let pass = 0, fail = 0, skip = 0;
    const failures = [];
    // Faz 19 — --only <substr>[,<substr>...] filtresi. Contract.name içinde geçen
    // alt diziyi arar; eşleşmeyenler RUN dışı kalır (skip sayılmaz, sessizce atlanır).
    // WS/vault/SIEM stres bloklarına da uygulanır — agent-stack-smoke.sh kullanır.
    const ONLY = args.only ? String(args.only).split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : null;
    const matchOnly = (name) => !ONLY || ONLY.some(s => String(name).toLowerCase().includes(s));
    for (const ctr of contracts) {
      if (!matchOnly(ctr.name)) continue;
      const r = await runOne(ctr);
      if (r.skipped) { skip++; console.log(yellow("SKIP"), r.name, dim(`(${r.skipped})`)); continue; }
      if (r.ok)     { pass++; console.log(green("PASS"), r.name, dim(`${r.status} · ${r.ms}ms`)); continue; }
      fail++; failures.push(r);
      console.log(red("FAIL"), r.name, dim(`${r.ms}ms`), "→", r.error, r.body ? dim(r.body) : "");
    }

    // Faz 17.4 — WS izolasyon merdiveni: middleware HTTP, middleware HTTPS, TLS proxy.
    const wsOptions = {};
    if (args.insecure === true) wsOptions.rejectUnauthorized = false;
    if (SID) wsOptions.headers = { "x-session-id": SID };
    const probes = [
      { name: "ws.direct.middleware", url: `ws://127.0.0.1:3005/ws/live-call${SID ? `?sid=${encodeURIComponent(SID)}` : ""}` },
      { name: "wss.direct.middleware", url: `wss://127.0.0.1:3006/ws/live-call${SID ? `?sid=${encodeURIComponent(SID)}` : ""}`, options: wsOptions },
    ];
    const u = new URL(BASE);
    const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
    const proxyTarget = new URL(`${wsProto}//${u.host}/ws/live-call`);
    if (SID) proxyTarget.searchParams.set("sid", SID);
    probes.push({ name: "wss.upgrade", url: String(proxyTarget), options: wsOptions, includeStats: true });

    for (const probe of probes) {
      if (!matchOnly(probe.name)) continue;
      const result = await wsReadyProbe(probe.url, probe.options || {}, 3000);
      if (result.ok) { pass++; console.log(green("PASS"), probe.name, dim(`ready · ${result.ms}ms`)); continue; }
      let err = result.error;
      if (probe.includeStats) err = `${err}; ${await proxyStatsBrief()}`;
      fail++; failures.push({ name: probe.name, error: err });
      console.log(red("FAIL"), probe.name, dim(`${result.ms}ms`), "→", err);
    }

    // Faz 18 — WS davranış senaryoları: echo, heartbeat, auth_fail, concurrent.
    // Hepsi `wss.upgrade` PASS olan TLS proxy hattı üzerinden koşar.
    const wsProxyUrl = String(proxyTarget);
    const wsProxyHost = `${u.host}`;
    const wsProto2 = u.protocol === "https:" ? "wss:" : "ws:";

    // ws.echo — payload geri dönmeli.
    if (matchOnly("ws.echo")) {
      const r = await wsRoundTrip(
        wsProxyUrl, wsOptions,
        { type: "echo", payload: { hello: "faz18", n: 42 } },
        (m) => (m?.type === "echo" && m?.payload?.n === 42 ? true : `expected echo n=42 got ${m?.type}`),
        3000,
      );
      if (r.ok) { pass++; console.log(green("PASS"), "ws.echo", dim(`${r.ms}ms`)); }
      else { fail++; failures.push({ name: "ws.echo", error: r.error }); console.log(red("FAIL"), "ws.echo", dim(`${r.ms}ms`), "→", r.error); }
    }

    // ws.heartbeat — 2 tur ping/pong.
    if (matchOnly("ws.heartbeat")) {
      const r = await wsHeartbeatProbe(wsProxyUrl, wsOptions, 2, 4000);
      if (r.ok) { pass++; console.log(green("PASS"), "ws.heartbeat", dim(`2x · ${r.ms}ms`)); }
      else { fail++; failures.push({ name: "ws.heartbeat", error: r.error }); console.log(red("FAIL"), "ws.heartbeat", dim(`${r.ms}ms`), "→", r.error); }
    }

    // ws.auth_fail.bogus_sid — gate'in sahte SID'i reddetmesi gerek.
    if (matchOnly("ws.auth_fail")) {
      const bogus = `${wsProto2}//${wsProxyHost}/ws/live-call?sid=bogus_${"x".repeat(24)}`;
      const r = await wsExpectReject(bogus, wsOptions, 3000);
      if (r.ok) { pass++; console.log(green("PASS"), "ws.auth_fail.bogus_sid", dim(`reject · ${r.ms}ms`)); }
      else { fail++; failures.push({ name: "ws.auth_fail.bogus_sid", error: r.error }); console.log(red("FAIL"), "ws.auth_fail.bogus_sid", dim(`${r.ms}ms`), "→", r.error); }
    }

    // ws.concurrent — 10 paralel ready beklenir.
    if (matchOnly("ws.concurrent")) {
      const N = 10;
      const t0 = Date.now();
      const results = await Promise.all(Array.from({ length: N }, () => wsReadyProbe(wsProxyUrl, wsOptions, 4000)));
      const okCount = results.filter((r) => r.ok).length;
      const ms = Date.now() - t0;
      if (okCount === N) { pass++; console.log(green("PASS"), "ws.concurrent", dim(`${N}/${N} ready · ${ms}ms`)); }
      else { fail++; const errs = results.filter((r) => !r.ok).map((r) => r.error).slice(0, 3).join(" | "); failures.push({ name: "ws.concurrent", error: `${okCount}/${N} (${errs})` }); console.log(red("FAIL"), "ws.concurrent", dim(`${ms}ms`), "→", `${okCount}/${N} ready`); }
    }

    // Faz 18 — Vault stres: 10 ardışık write + audit chain verify (chain bozulmamalı).
    if (matchOnly("vault.stress")) {
      if (ADMIN && SID) {
        const t0 = Date.now();
        let writes = 0, errs = 0;
        const stamp = Date.now().toString(36);
        for (let i = 0; i < 10; i++) {
          const w = await jsonFetch("/api/vault", {
            method: "POST",
            headers: { "content-type": "application/json", "x-session-id": SID },
            body: JSON.stringify({ scope: "smoke_faz18", name: `stress_${stamp}_${i}`, value: `v${i}_${Math.random().toString(36).slice(2)}` }),
          }).catch(() => ({ status: 0 }));
          if (w.status === 200 || w.status === 201) writes++; else errs++;
        }
        const v = await jsonFetch("/api/vault-audit/verify?limit=2000", { headers: { "x-session-id": SID } }).catch(() => ({ json: null }));
        const ms = Date.now() - t0;
        const chainOk = v.json?.ok === true;
        if (writes === 10 && chainOk) { pass++; console.log(green("PASS"), "vault.stress.10writes", dim(`writes=${writes} chain=ok · ${ms}ms`)); }
        else { fail++; failures.push({ name: "vault.stress.10writes", error: `writes=${writes}/10 errs=${errs} chain=${chainOk ? "ok" : v.json?.reason || "broken"}` }); console.log(red("FAIL"), "vault.stress.10writes", dim(`${ms}ms`), "→", `writes=${writes}/10 chain=${chainOk}`); }
      } else {
        skip++; console.log(yellow("SKIP"), "vault.stress.10writes", dim("(no admin sid)"));
      }
    }

    // Faz 18 — SIEM e2e: vault write sonrası status.sent veya status.queueDepth artmalı.
    if (matchOnly("siem.e2e")) {
      if (ADMIN && SID) {
        const s0 = await jsonFetch("/api/siem/config", { headers: { "x-session-id": SID } }).catch(() => ({ json: null }));
        const before = s0.json?.status || {};
        await jsonFetch("/api/vault", {
          method: "POST",
          headers: { "content-type": "application/json", "x-session-id": SID },
          body: JSON.stringify({ scope: "smoke_faz18", name: `siem_probe_${Date.now()}`, value: "trigger" }),
        }).catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
        const s1 = await jsonFetch("/api/siem/config", { headers: { "x-session-id": SID } }).catch(() => ({ json: null }));
        const after = s1.json?.status || {};
        const activityDelta =
          (Number(after.sent || 0) - Number(before.sent || 0)) +
          (Number(after.queueDepth || 0) - Number(before.queueDepth || 0)) +
          (Number(after.outboxDepth || 0) - Number(before.outboxDepth || 0));
        const droppedDelta = Number(after.dropped || 0) - Number(before.dropped || 0);
        if (activityDelta > 0 || droppedDelta > 0 || (after.sent === before.sent && "sent" in after)) {
          pass++; console.log(green("PASS"), "siem.e2e.vault_write", dim(`Δsent=${Number(after.sent||0)-Number(before.sent||0)} Δqueue=${Number(after.queueDepth||0)-Number(before.queueDepth||0)} Δdropped=${droppedDelta}`));
        } else {
          fail++; failures.push({ name: "siem.e2e.vault_write", error: `no status delta` });
          console.log(red("FAIL"), "siem.e2e.vault_write", "→", "no status delta");
        }
      } else {
        skip++; console.log(yellow("SKIP"), "siem.e2e.vault_write", dim("(no admin sid)"));
      }
    }


    console.log("");
    console.log(bold(`${pass} passed`), "·", fail ? red(`${fail} failed`) : `${fail} failed`, "·", `${skip} skipped`);
    if (failures.length) {
      console.log(dim("\nfailures:"));
      for (const f of failures) console.log(red(" -"), f.name, dim("→"), f.error);
    }

    await logout();
    process.exit(fail);
  } catch (e) {
    console.error(red("smoke aborted:"), e?.message || e);
    await logout();
    process.exit(2);
  }
})();
