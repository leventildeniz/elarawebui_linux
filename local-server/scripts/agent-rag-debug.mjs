#!/usr/bin/env node
// agent-rag-debug.mjs — bir agent'i gerçek hatta çalıştırır, SSE'yi tüketir,
// `agent_done` envelope'undan rag/reranker kanıtını çıkartır. Backend agent yolu
// reranker bilgisini gerçekten emit ediyor mu, retrieval mi yoksa reranker mı
// karar veriyor — bunu kanıtlar. UI mapping (chat.tsx 1219) bu payload'la uyumlu.
//
// Kullanım:
//   bun local-server/scripts/agent-rag-debug.mjs --agent Firewall_Oracle "fortimanagerda vlan nasıl açılır?"
//   ELARA_ADMIN_TOKEN=... bun local-server/scripts/agent-rag-debug.mjs --agent Firewall_Oracle "..."
//
// Çıktı:
//   AGENT  <name> id=<uuid>
//   RAG    enabled=true hits=N decision=inject top1=0.xx tau=0.xx
//   RERANK used=true ms=523 model=BAAI/bge-reranker-v2-m3 reason=ok
//   GATE   {...} (varsa)
//   SOURCES
//     #1 <brand> <name> score=0.xx rr=0.xx
//   TELEMETRY thinkMs=... ragMs=... totalMs=... tokensOut=...
//   STDOUT (first 300 char)

import process from "node:process";
import readline from "node:readline";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const args = process.argv.slice(2);
let base = process.env.AGENT_DEBUG_BASE || process.env.RAG_DEBUG_BASE || "https://elara.local:10443";
let agent = null;
const q = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--base") base = args[++i];
  else if (a === "--agent") agent = args[++i];
  else q.push(a);
}
const query = q.join(" ").trim();
if (!agent || !query) {
  console.error("Kullanım: agent-rag-debug.mjs --agent <name|id> \"<query>\"");
  process.exit(2);
}

function promptLine(label, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!hidden) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(label, (ans) => { rl.close(); resolve(ans); });
      return;
    }
    process.stdout.write(label);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const onData = (ch) => {
      if (ch === "\n" || ch === "\r" || ch === "\u0004") {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw || false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(buf);
      } else if (ch === "\u0003") {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw || false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        reject(new Error("aborted"));
      } else if (ch === "\u007f" || ch === "\b") {
        if (buf.length) { buf = buf.slice(0, -1); process.stdout.write("\b \b"); }
      } else {
        buf += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

const headers = { "Content-Type": "application/json" };
const envToken = process.env.ELARA_ADMIN_TOKEN || process.env.ADMIN_TOKEN || "";
if (envToken) {
  headers["Authorization"] = `Bearer ${envToken}`;
  console.log(`LOGIN  using ELARA_ADMIN_TOKEN (env)`);
} else {
  let username, password;
  try {
    username = (await promptLine("Username: ")).trim();
    password = await promptLine("Password: ", { hidden: true });
  } catch {
    console.error("aborted");
    process.exit(2);
  }
  if (!username || !password) {
    console.error("Username/password boş olamaz");
    process.exit(2);
  }
  const lr = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const lj = await lr.json().catch(() => ({}));
  if (!lr.ok || !lj?.ok || !lj?.sessionId) {
    console.error(`LOGIN  FAIL  http=${lr.status}  ${JSON.stringify(lj)}`);
    process.exit(1);
  }
  headers["X-Session-Id"] = lj.sessionId;
  const who = lj.user ? `${lj.user.username || username}${lj.user.role ? ` (${lj.user.role})` : ""}` : username;
  console.log(`LOGIN  ok  sessionId=${lj.sessionId}  user=${who}`);
  console.log("");
}

async function resolveAgentId(nameOrId) {
  if (/^[0-9a-f-]{36}$/i.test(nameOrId)) return { id: nameOrId, name: nameOrId };
  const r = await fetch(`${base}/api/agents?limit=500`, { headers });
  if (!r.ok) throw new Error(`/api/agents ${r.status}`);
  const body = await r.json();
  const list = Array.isArray(body?.agents) ? body.agents : (Array.isArray(body) ? body : []);
  const needle = nameOrId.toLowerCase().replace(/\.py$/, "");
  const hit = list.find((a) => {
    const n = String(a.name || "").toLowerCase().replace(/\.py$/, "");
    return n === needle || n.includes(needle);
  });
  if (!hit) throw new Error(`agent not found: ${nameOrId} (matched 0 of ${list.length})`);
  return { id: hit.id, name: hit.name };
}

function parseSseEvents(text) {
  const out = [];
  for (const block of text.split(/\n\n/)) {
    const line = block.split(/\n/).find((l) => l.startsWith("data: "));
    if (!line) continue;
    const data = line.slice(6).trim();
    if (!data || data === "[DONE]") continue;
    try { out.push(JSON.parse(data)); } catch { /* */ }
  }
  return out;
}

(async () => {
  const { id, name } = await resolveAgentId(agent);
  console.log(`AGENT  ${name}  id=${id}`);
  console.log(`QUERY  ${JSON.stringify(query)}`);
  console.log("");

  const t0 = Date.now();
  const r = await fetch(`${base}/api/agents/${id}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: query, stream: true, locale: "tr" }),
  });
  if (!r.ok || !r.body) {
    console.error(`HTTP ${r.status}  ${await r.text().catch(() => "")}`);
    process.exit(1);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let lastDone = null;
  let chunkCount = 0;
  let firstChunkLogged = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const idx = buf.lastIndexOf("\n\n");
    if (idx === -1) continue;
    const ready = buf.slice(0, idx + 2);
    buf = buf.slice(idx + 2);
    for (const ev of parseSseEvents(ready)) {
      if (ev.type === "agent_thinking") {
        const suffix = ev.phase === "rag_done"
          ? ` hits=${ev.hits ?? "?"} decision=${ev.decision || "-"}`
          : (ev.ms ? ` ms=${ev.ms}` : "");
        console.log(`PHASE  ${ev.phase || "thinking"}${suffix}`);
      } else if (ev.type === "agent_chunk") {
        chunkCount++;
        if (!firstChunkLogged) {
          firstChunkLogged = true;
          console.log(`PHASE  first_chunk t=${Date.now() - t0}ms`);
        }
      } else if (ev.type === "agent_done") lastDone = ev;
    }
  }
  const elapsed = Date.now() - t0;
  console.log(`---- SSE consumed in ${elapsed}ms · agent_chunk frames=${chunkCount} ----\n`);
  if (!lastDone) {
    console.error("HATA: agent_done event alınmadı.");
    process.exit(1);
  }
  const meta = lastDone.rag || null;
  if (!meta) {
    console.log("RAG    <absent in agent_done envelope>");
  } else {
    console.log(`RAG    enabled=${meta.enabled !== false} hits=${meta.hits ?? "?"} decision=${meta.decision || "?"} top1=${meta.top1 ?? "?"} tau=${meta.tau ?? "?"} mode=${meta.mode || "-"}`);
    const rr = meta.rerankInfo || meta.reranker || null;
    if (!rr) {
      console.log("RERANK <absent in rag.meta — backend reranker bilgisi göndermedi>");
    } else {
      console.log(`RERANK used=${!!rr.used} ms=${rr.ms ?? "-"} model=${rr.model || "-"} reason=${rr.reason || "-"}${rr.lastError ? ` err=${rr.lastError}` : ""}`);
      if (rr.gate) console.log(`GATE   ${JSON.stringify(rr.gate)}`);
    }
    if (Array.isArray(meta.sources) && meta.sources.length) {
      console.log("SOURCES");
      meta.sources.slice(0, 6).forEach((s) => {
        console.log(`  #${s.index ?? "?"} ${s.brand || "?"} · ${s.name || "?"} · score=${s.score ?? "-"}`);
      });
    }
  }
  const tel = lastDone.telemetry || null;
  if (tel) {
    console.log(`TELEM  thinkMs=${tel.thinkMs ?? "-"} ragMs=${tel.ragMs ?? "-"} totalMs=${tel.totalMs ?? "-"} tokensOut=${tel.tokensOut ?? "-"}`);
  }
  console.log(`OK     ok=${lastDone.ok} latencyMs=${lastDone.latencyMs ?? "-"}`);
  if (lastDone.stderr) {
    const tail = String(lastDone.stderr).split(/\n/).filter((l) => /agent-rag|rerank/i.test(l)).slice(-6);
    if (tail.length) {
      console.log("\nSTDERR (agent-rag/rerank lines):");
      tail.forEach((l) => console.log("  " + l));
    }
  }
})().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
