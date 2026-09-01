// local-server/lib/meta-forge/smoke.mjs
// Sandbox smoke for newly-forged Python tools.
// Contract: python3 <file>, stdin={"__probe":true}, timeout 5s.
// Return {ok, ms, stderr, stdout} — DOES NOT throw.
// Tools that don't understand __probe should still exit 0 (or return
// {"ok":true|false,"reason":...}); non-zero exit or timeout = fail.

import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 5000;

export function runToolSmoke(filePath, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = "";
    let stderr = "";
    let done = false;
    let child;
    try {
      child = spawn("python3", [filePath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
    } catch (e) {
      resolve({ ok: false, ms: 0, stderr: `spawn: ${e?.message || e}`, stdout: "" });
      return;
    }
    const finish = (ok, reason) => {
      if (done) return;
      done = true;
      try { child.kill("SIGKILL"); } catch { /* */ }
      resolve({
        ok,
        ms: Date.now() - t0,
        stderr: (stderr + (reason ? `\n[smoke] ${reason}` : "")).slice(-2000),
        stdout: stdout.slice(-2000),
      });
    };
    const timer = setTimeout(() => finish(false, `timeout ${timeoutMs}ms`), timeoutMs);
    child.stdout.on("data", (b) => { stdout += b.toString("utf8"); });
    child.stderr.on("data", (b) => { stderr += b.toString("utf8"); });
    child.on("error", (e) => { clearTimeout(timer); finish(false, `error: ${e?.message || e}`); });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0, code === 0 ? "" : `exit ${code}`);
    });
    try {
      child.stdin.write(JSON.stringify({ __probe: true }) + "\n");
      child.stdin.end();
    } catch (e) {
      finish(false, `stdin: ${e?.message || e}`);
    }
  });
}
