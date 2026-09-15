// =============================================================================
// disk-runner.mjs — Disk-bound Python Runner
// Safe executor for disk-bound python scripts (tools/ and skills/).
// Validates file existence, file extension, and absolute path, then executes
// with execFile from the script's directory.
// =============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

function sanitizeQueryArg(q) {
  const s = q == null ? "" : String(q);
  // Strip control characters and null bytes
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ").slice(0, 64 * 1024);
}

/**
 * Executes a python script located on disk.
 * @param {Object} opts
 * @param {string} opts.script  absolute path, must end with .py and exist
 * @param {string} [opts.query] passed as sys.argv[1] (UTF-8, max 64KB)
 * @param {Object} [opts.env]   extra environment variables
 * @param {string} [opts.python] python binary; default ELARA_AGENTS_PYTHON || python3
 * @param {number} [opts.timeoutMs] hard timeout; default 60s
 */
export async function runDiskScript(opts) {
  let script = String(opts?.script || "").trim();
  if (!script) throw new Error("disk-runner: missing script");
  if (!path.isAbsolute(script)) {
    script = path.resolve(process.cwd(), script);
  }
  if (!script.toLowerCase().endsWith(".py")) throw new Error(`disk-runner: not a .py: ${script}`);
  let stat;
  try { stat = fs.statSync(script); }
  catch (e) { throw new Error(`disk-runner: file not found: ${script} (${e.message || e})`); }
  if (!stat.isFile()) throw new Error(`disk-runner: not a regular file: ${script}`);

  const cwd = path.dirname(script);
  const safeQuery = sanitizeQueryArg(opts.query);
  const python = opts.python || process.env.ELARA_AGENTS_PYTHON || "python3";
  const timeoutMs = Number(opts.timeoutMs || process.env.ELARA_AGENTS_TIMEOUT_MS || 60_000);

  const childEnv = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
    LANG: process.env.LANG || "tr_TR.UTF-8",
    LC_ALL: process.env.LC_ALL || "tr_TR.UTF-8",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    HOME: process.env.HOME || "",
    ...(opts.env || {}),
  };

  return new Promise((resolve, reject) => {
    const child = execFile(python, [script, safeQuery], {
      cwd,
      env: childEnv,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf-8",
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        // Even on non-zero exit code, capture valid error JSON from stdout if emitted
        if (stdout && stdout.trim()) {
          resolve({ stdout: String(stdout || ""), stderr: String(stderr || err.message) });
        } else {
          reject(err);
        }
      } else {
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      }
    });

    // Hem argv[1] hem stdin üzerinden besleme yaparak sys.stdin ve sys.argv uyumluluğu sağlıyoruz
    if (child.stdin) {
      child.stdin.on("error", () => {});
      if (safeQuery) {
        child.stdin.write(safeQuery);
      }
      child.stdin.end();
    }
  });
}
