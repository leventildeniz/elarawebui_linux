// Pure port / process / lsof utilities. State'siz, dep'siz.
// Block C Tur 1 — server.mjs'ten taşındı 2026-05-30.
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";

const LSOF_PATHS = [...new Set([
  process.env.LSOF_BIN,
  "/usr/sbin/lsof",
  "/usr/bin/lsof",
  "lsof",
].filter(Boolean))];

function runLsof(args, timeout = 1500) {
  const env = {
    ...process.env,
    PATH: ["/usr/sbin", "/usr/bin", "/bin", "/sbin", process.env.PATH || ""].filter(Boolean).join(":"),
  };
  let lastErr = null;
  for (const bin of LSOF_PATHS) {
    try {
      return execFileSync(bin, args, { stdio: ["ignore", "pipe", "ignore"], timeout, env }).toString();
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return "";
}

export function isPortOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host });
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { s.destroy(); } catch {} resolve(v); } };
    s.once("connect", () => finish(true));
    s.once("error", () => finish(false));
    setTimeout(() => finish(false), 600);
  });
}

export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function waitForPidExit(pid, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!pidAlive(pid)) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return !pidAlive(pid);
}

// LISTEN-only PID list (eski davranış); restart hattı listPortPids'i tercih eder.
export function killPortOwner(port) {
  try {
    const out = runLsof(["-t", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]).trim();
    const pids = out.split(/\s+/).filter(Boolean).map(Number);
    for (const pid of pids) {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
    return pids;
  } catch { return []; }
}

// Bir port'a değen TÜM PID'leri döndürür (LISTEN + ESTABLISHED + CLOSED FD).
export function listPortPids(port) {
  try {
    const out = runLsof(["-t", "-nP", `-iTCP:${port}`]).trim();
    return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))].sort((a, b) => a - b);
  } catch { return []; }
}

// Detailed socket listing — PID, command, TCP state, local + remote address.
export function listPortSockets(port) {
  try {
    const raw = runLsof(["-nP", `-iTCP:${port}`]);
    const lines = raw.split("\n").slice(1).filter(Boolean);
    const rows = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;
      const command = parts[0];
      const pid = Number(parts[1]);
      const nameAndState = parts.slice(8).join(" ");
      const stateMatch = nameAndState.match(/\(([A-Z_]+)\)\s*$/);
      const state = stateMatch ? stateMatch[1] : "";
      const addr = stateMatch ? nameAndState.slice(0, stateMatch.index).trim() : nameAndState.trim();
      const arrow = addr.includes("->") ? addr.split("->") : [addr, ""];
      rows.push({
        pid,
        command,
        state,
        local: (arrow[0] || "").trim(),
        remote: (arrow[1] || "").trim(),
      });
    }
    return rows;
  } catch { return []; }
}

export function summarizeSocketStates(sockets) {
  const counts = {};
  for (const s of sockets) {
    const k = s.state || "UNKNOWN";
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

// SIGTERM all holders → 1.5s grace → SIGKILL stragglers. Returns kill count.
export async function killPortOwnerAndWait(port, timeoutMs = 5000) {
  const pids = listPortPids(port);
  if (pids.length === 0) return 0;
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  for (const pid of pids) {
    const died = await waitForPidExit(pid, Math.min(1500, timeoutMs));
    if (!died) {
      try { process.kill(pid, "SIGKILL"); } catch {}
      await waitForPidExit(pid, 1500);
    }
  }
  return pids.length;
}

// ---------------------------------------------------------------------------
// launchd label discovery — dinamik, servis adına bağımsız.
// PID → `launchctl procinfo <pid>` çıktısından "service = <label>" satırını
// çeker. Model/servis adı değişse de (qwen72b → gemma4-31b → ...) doğru
// label bulunur. Discovery cache'lenir: port boşaldığında (kill sonrası) son
// bilinen label ile restart komutu kurulabilir.
// ---------------------------------------------------------------------------

const LAUNCHCTL_PATHS = [...new Set([
  process.env.LAUNCHCTL_BIN,
  "/bin/launchctl",
  "launchctl",
].filter(Boolean))];

function runLaunchctl(args, timeout = 1500) {
  const env = {
    ...process.env,
    PATH: ["/bin", "/usr/bin", "/usr/sbin", "/sbin", process.env.PATH || ""].filter(Boolean).join(":"),
  };
  let lastErr = null;
  for (const bin of LAUNCHCTL_PATHS) {
    try {
      return execFileSync(bin, args, { stdio: ["ignore", "pipe", "ignore"], timeout, env }).toString();
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return "";
}

// PID'den launchd label çek. `launchctl procinfo <pid>` çıktısında
// "service = com.elara.<something>" satırı olur.
export function launchdLabelForPid(pid) {
  if (!pid || !Number.isFinite(Number(pid))) return null;
  try {
    const out = runLaunchctl(["procinfo", String(pid)], 2000);
    // "service = com.elara.gemma4-31b" veya "com.elara.qwen72b" vb.
    const m = out.match(/service\s*=\s*([A-Za-z0-9_.\-]+)/);
    if (m && m[1]) return m[1];
  } catch {}
  return null;
}

// Port'u tutan PID'lerden ilk launchd label'ı bul. Kernel/launchd-managed
// olmayan process için null döner.
export function discoverLaunchdLabelForPort(port) {
  const pids = listPortPids(port);
  for (const pid of pids) {
    const label = launchdLabelForPid(pid);
    if (label) return label;
  }
  return null;
}

// Fallback: `launchctl list` çıktısını tara, label pattern'ine uy.
// Port boş + cache boş + LLM_RESTART_CMD yok senaryosu için son çare.
export function findLaunchdLabelByPattern(patterns = [/^com\.elara\.(qwen|gemma|llama|mistral|mlx|llm)/i]) {
  try {
    const out = runLaunchctl(["list"], 2000);
    const lines = out.split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const label = parts[2];
      for (const pat of patterns) {
        if (pat.test(label)) return label;
      }
    }
  } catch {}
  return null;
}

function _readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function _xmlUnescape(s) {
  return String(s || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function _plistStringAfterKey(text, key) {
  const re = new RegExp(`<key>${key}<\\/key>\\s*<string>([\\s\\S]*?)<\\/string>`, "i");
  const m = String(text || "").match(re);
  return m ? _xmlUnescape(m[1]).trim() : "";
}

function _plistStringArrayAfterKey(text, key) {
  const re = new RegExp(`<key>${key}<\\/key>\\s*<array>([\\s\\S]*?)<\\/array>`, "i");
  const m = String(text || "").match(re);
  if (!m) return [];
  return [...m[1].matchAll(/<string>([\s\S]*?)<\/string>/gi)]
    .map((x) => _xmlUnescape(x[1]).trim())
    .filter(Boolean);
}

function _plistEnvDict(text) {
  const m = String(text || "").match(/<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/i);
  if (!m) return {};
  const env = {};
  const re = /<key>([^<]+)<\/key>\s*<string>([\s\S]*?)<\/string>/gi;
  for (const item of m[1].matchAll(re)) {
    const k = _xmlUnescape(item[1]).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    env[k] = _xmlUnescape(item[2]).trim();
  }
  return env;
}

function _plistLabel(text, fallbackFile = "") {
  const m = String(text || "").match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/i);
  if (m && m[1]) return m[1].trim();
  const b = path.basename(String(fallbackFile || ""), ".plist");
  return b || "";
}

function _runtimeNeedles({ port, baseUrl, model } = {}) {
  const needles = [];
  if (port) needles.push(String(port));
  try {
    const u = new URL(String(baseUrl || ""));
    if (u.port) needles.push(u.port);
    if (u.hostname) needles.push(u.hostname);
  } catch {}
  const rawModel = String(model || "").trim();
  if (rawModel) {
    needles.push(rawModel);
    for (const part of rawModel.split(/[^A-Za-z0-9]+/).filter((x) => x.length >= 4)) needles.push(part);
  }
  return [...new Set(needles.filter(Boolean))];
}

// Find an MLX-ish LaunchAgent/Daemon plist without relying on a hardcoded
// service label. Works even when the service is currently unloaded and port
// discovery has no PID to inspect.
export function findLaunchdRuntimePlist(opts = {}) {
  const home = os.homedir?.() || process.env.HOME || "";
  const dirs = [
    home ? path.join(home, "Library/LaunchAgents") : "",
    "/Library/LaunchAgents",
    "/Library/LaunchDaemons",
  ].filter(Boolean);
  const needles = _runtimeNeedles(opts).map((s) => s.toLowerCase());
  const deny = /\b(com\.elara\.(middleware|vite|tls-proxy|postgres|backup)|postgres|vite|middleware|tls-proxy|backup)\b/i;
  const candidates = [];
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".plist")); } catch { continue; }
    for (const f of files) {
      const file = path.join(dir, f);
      const text = _readText(file);
      if (!text) continue;
      const label = _plistLabel(text, file);
      const hay = `${label}\n${file}\n${text}`.toLowerCase();
      if (deny.test(label) || deny.test(file)) continue;
      let score = 0;
      if (/mlx[_\-.]?lm|mlx_lm\.server|mlx-lm|python[^\n]+mlx/i.test(text)) score += 100;
      if (/^com\.elara\.(qwen|gemma|llama|mistral|mlx|llm)/i.test(label)) score += 50;
      if (/\b(qwen|gemma|llama|mistral|mlx|llm)\b/i.test(`${label} ${file}`)) score += 25;
      for (const n of needles) {
        if (!n) continue;
        if (hay.includes(n)) score += /^\d+$/.test(n) ? 35 : 12;
      }
      if (score > 0) candidates.push({ label, plist: file, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return candidates[0] || null;
}

// Parse a discovered LaunchAgent plist into a direct process start recipe. This
// is the service-independent escape hatch: if launchd refuses to load/bootstrap
// a plist (Load failed: 5, bad domain, unloaded service, Linux later, etc.) the
// middleware can still execute the same ProgramArguments directly.
export function readLaunchdPlistRuntimeCommand(plistFile) {
  const text = _readText(plistFile);
  if (!text) return null;
  const args = _plistStringArrayAfterKey(text, "ProgramArguments");
  const program = _plistStringAfterKey(text, "Program");
  const argv = args.length ? args : (program ? [program] : []);
  if (!argv.length) return null;
  return {
    file: argv[0],
    args: argv.slice(1),
    cwd: _plistStringAfterKey(text, "WorkingDirectory") || path.dirname(plistFile),
    env: _plistEnvDict(text),
    source: plistFile,
  };
}

// Linux/systemd analogue for future installs: discover a user/system service
// file by command/port/model content instead of baking a unit name into code.
export function findSystemdRuntimeUnit(opts = {}) {
  const home = os.homedir?.() || process.env.HOME || "";
  const dirs = [
    home ? path.join(home, ".config/systemd/user") : "",
    "/etc/systemd/user",
    "/etc/systemd/system",
  ].filter(Boolean);
  const needles = _runtimeNeedles(opts).map((s) => s.toLowerCase());
  const deny = /\b(middleware|vite|postgres|tls-proxy|backup)\b/i;
  const candidates = [];
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".service")); } catch { continue; }
    for (const f of files) {
      const file = path.join(dir, f);
      const text = _readText(file);
      if (!text || deny.test(f)) continue;
      const hay = `${f}\n${file}\n${text}`.toLowerCase();
      let score = 0;
      if (/mlx[_\-.]?lm|mlx_lm\.server|mlx-lm|python[^\n]+mlx/i.test(text)) score += 100;
      if (/\b(qwen|gemma|llama|mistral|mlx|llm)\b/i.test(`${f} ${file}`)) score += 25;
      for (const n of needles) {
        if (!n) continue;
        if (hay.includes(n)) score += /^\d+$/.test(n) ? 35 : 12;
      }
      if (score > 0) candidates.push({ unit: f, file, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.unit.localeCompare(b.unit));
  return candidates[0] || null;
}

export function readSystemdServiceRuntimeCommand(serviceFile) {
  const text = _readText(serviceFile);
  if (!text) return null;
  const line = text.split(/\r?\n/).map((s) => s.trim()).find((s) => /^ExecStart\s*=/.test(s));
  if (!line) return null;
  let command = line.replace(/^ExecStart\s*=\s*/, "").trim();
  command = command.replace(/^[-@]+/, "").trim();
  if (!command) return null;
  const cwd = (text.split(/\r?\n/).map((s) => s.trim()).find((s) => /^WorkingDirectory\s*=/.test(s)) || "")
    .replace(/^WorkingDirectory\s*=\s*/, "")
    .trim();
  return { command, cwd: cwd || "", source: serviceFile };
}

// pg_dump / pg_restore / psql wrapper. Streams stdin → child.
export function spawnPg(tool, args, { input, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(tool, args, {
      maxBuffer: 1024 * 1024 * 512,
      env: { ...process.env, ...(env || {}) },
    }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr?.toString?.() ?? ""; return reject(err); }
      resolve({ stdout, stderr });
    });
    if (input != null) { child.stdin.write(input); child.stdin.end(); }
  });
}
