// agent-bridge.mjs — ELARA otonom ajan köprüsü.
// Model çıktısındaki "tetikliyorum: x.py" / "@[x.py]" / "running x.py" niyetlerini
// yakalar, whitelist'li bir yerel Python betiğini güvenle koşturur ve stdout'u
// chat akışına enjekte edilebilecek temizlikte döner.
//
// Tasarım mühürleri:
//  - Türkçe + İngilizce doğal dil varyantlarını yakalayan Unicode regex.
//  - execFile (shell yorumlamaz) + argv array → shell injection cephesi kapalı.
//  - Whitelist + path-escape mührü.
//  - Hata sınıflandırma + locale-aware maskelenmiş fallback metinleri.

import { execFile, spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { localQueue } from "./runtime-queue.mjs";
import { RUNTIME_TRANSPORT } from "./runtime-transport.mjs";
import { QUEUE_PRIORITY, QUEUE_TIMEOUTS, getAgentPriority } from "./queue-config.mjs";

const execFileAsync = promisify(execFile);

let _pool = null;
export function setAgentBridgePool(p) {
  _pool = p;
}

// --- Regex: Türkçe + İngilizce doğal dil + açık etiket ---------------------
const TR_VERBS =
  "tetikliyorum|tetikledim|çalıştırıyorum|calistiriyorum|" +
  "başlatıyorum|baslatiyorum|koşturuyorum|kosturuyorum|" +
  "mühürlüyorum|muhurluyorum|çağırıyorum|cagiriyorum";
const EN_VERBS =
  "running|fires?|firing|executing|execute|spawn(?:ing)?|invoking|invoke|launching|launch|calling|call";

// Unicode flag (u) zorunlu; \p{L}\p{N} Türkçe karakterleri tek codepoint olarak yakalar.
const AGENT_TRIGGER_RE = new RegExp(
  // 1) Açık etiket: @[researcher.py]
  String.raw`@\[\s*([\p{L}\p{N}_\-./]+\.py)\s*\]` +
  "|" +
  // 2) Fiil + (opsiyonel "script(i)") + .py adı: "tetikliyorum: researcher.py", "running harvester.py"
  String.raw`(?:${TR_VERBS}|${EN_VERBS})[:\s]+(?:script[''ı]?n?[ıi]?[:\s]+)?([\p{L}\p{N}_\-./]+\.py)` +
  "|" +
  // 3) "script(i)" + fiil (script adı YOK) → default agent (researcher.py)
  String.raw`script[''ı]?n?[ıi]?\s+(?:${TR_VERBS}|${EN_VERBS})`,
  "iu"
);

/**
 * Modelin asistan çıktısında ajan tetikleme niyeti var mı?
 * @param {string} assistantText Modelin ürettiği serbest metin.
 * @param {string} userQuery Kullanıcının orijinal sorgusu (Python'a argv[1] olarak gider).
 * @returns {{ script: string, query: string } | null}
 */
export function detectAgentIntent(assistantText, userQuery) {
  // 2026-06-02 — Tetikleyici hem model çıktısında hem kullanıcı promptunda
  // taranır. Kullanıcı doğrudan `@[script.py]` yazdıysa (ya da rewrite katmanı
  // doğal-dil niyetini bu tag'e çevirdiyse) model echo etmese de bridge spawn'ı
  // tetiklenir. RAG sistem prompt'undaki "tetikleme YOK" kuralı (kural #9)
  // bu hattı etkilemez.
  const userDirectAgent = /@\[\s*[\p{L}\p{N}_\-./]+\.py\s*\]/u.test(String(userQuery || ""));
  const candidates = [
    { text: assistantText, source: "assistant" },
    { text: userQuery, source: "user" },
  ].filter((x) => typeof x.text === "string" && x.text.length > 0);
  for (const { text, source } of candidates) {
    // Descriptive catalog/list answers can contain several `@[agent.py]` tags
    // because the generic protocol hint says agents use that syntax. If the user
    // did not explicitly request a concrete tag, never interpret a multi-tag
    // assistant catalog as an execution request.
    if (source === "assistant" && !userDirectAgent) {
      const tagCount = (String(text).match(/@\[\s*[\p{L}\p{N}_\-./]+\.py\s*\]/gu) || []).length;
      if (tagCount > 1) continue;
    }
    const m = text.match(AGENT_TRIGGER_RE);
    if (!m) continue;
    const script = (m[1] || m[2] || "researcher.py").trim();
    if (!/^[\p{L}\p{N}_\-./]+\.py$/u.test(script)) continue;
    // Manifest/help text may contain the documentation placeholder `@[slug.py]`.
    // That is not an execution request; never let it fall through to allow-list
    // denial and append a confusing agent error to normal meta answers.
    if (path.basename(script).toLowerCase() === "slug.py") continue;
    const cleanQuery = String(userQuery ?? "")
      .replace(new RegExp(String.raw`@\[\s*${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s*\]`, "iu"), " ")
      .replace(AGENT_TRIGGER_RE, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { script, query: cleanQuery || String(userQuery ?? "") };
  }
  return null;
}

// --- Argüman sanitizasyonu --------------------------------------------------
/**
 * execFile argv'ye gidecek serbest metni temizler.
 * - NUL ve kontrol karakterlerini boşluğa çevirir (sys.argv parse'ı bozar).
 * - Unicode NFC normalize (TR karakter tek codepoint).
 * - Newline'ları tek boşluğa indirir.
 * - 8 KB üst sınır.
 */
export function sanitizeQueryArg(raw) {
  let s = String(raw ?? "");
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  s = s.normalize("NFC");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 8000) s = s.slice(0, 8000);
  return s;
}

// --- Hata sınıflandırma -----------------------------------------------------
export function classifyAgentError(err) {
  if (!err) return "unknown";
  if (err.killed && (err.signal === "SIGKILL" || err.signal === "SIGTERM")) return "timeout";
  const msg = String(err.message || "");
  if (msg.includes("agent.denied")) return "denied";
  if (msg.includes("agent.path_escape")) return "path_escape";
  if (msg.includes("agent.empty_dir")) return "spawn";
  if (err.code === "ENOENT") return "spawn";
  if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") return "network";
  if (/network|fetch failed|getaddrinfo|socket hang up|ETIMEDOUT/i.test(msg)) return "network";
  if (typeof err.code === "number") return "exit_nonzero";
  return "unknown";
}

// --- Maskelenmiş, dile duyarlı kullanıcı mesajları --------------------------
export const AGENT_ERROR_TR = {
  timeout:      "Yerel ajan zaman aşımına uğradı, görev mühürlenemedi. Lütfen sorguyu daraltıp tekrar deneyin.",
  network:      "Şu an yerel hatta bir network darboğazı oluştu, terminal loglarını inceleyebilirsiniz.",
  denied:       "İstenen yerel ajan yetki listesinde değil, görev güvenlik mührüyle reddedildi.",
  path_escape:  "Geçersiz ajan yolu — güvenlik mührü ihlali, görev iptal edildi.",
  spawn:        "Yerel ajan başlatılamadı, Python ortamı veya betik bulunamadı.",
  exit_nonzero: "Yerel ajan hata kodu döndürdü, terminal loglarını inceleyebilirsiniz.",
  unknown:      "Yerel ajan beklenmedik bir durumla karşılaştı, terminal loglarını inceleyebilirsiniz.",
};
export const AGENT_ERROR_EN = {
  timeout:      "Local agent timed out; please narrow the query and retry.",
  network:      "Local network bottleneck detected; check the terminal logs for details.",
  denied:       "Requested local agent is not in the allow-list; the task was sealed off.",
  path_escape:  "Invalid agent path — security seal violated; task cancelled.",
  spawn:        "Local agent could not start; Python runtime or script not found.",
  exit_nonzero: "Local agent returned an error code; check the terminal logs.",
  unknown:      "Local agent hit an unexpected condition; check the terminal logs.",
};

export function agentErrorMessage(code, locale) {
  const dict = String(locale || "").toLowerCase().startsWith("tr") ? AGENT_ERROR_TR : AGENT_ERROR_EN;
  return dict[code] || dict.unknown;
}

function markAgentTimeoutDirty(scriptBase, timeoutMs, mode = "agent") {
  // Sovereign Refactor: Aggressive watchdog and dirty flag removed.
  // We only record the abort for monitoring purposes.
  RUNTIME_TRANSPORT.lastAbortAt = Date.now();
  RUNTIME_TRANSPORT.lastAbortReason = `${mode} first-token timeout: ${scriptBase} exceeded ${timeoutMs}ms`;
}

// --- Execution Intent Guard -------------------------------------------------
// Bu helper, kullanıcı metni veya model akışı içinde icra niyetinin (tool/skill/
// agent çağrısı) açıkça beyan edildiği anı yakalar. Niyet varsa router'ın
// length-heuristic / semantic-bypass kararları askıya alınmalıdır.
//
// Yakalanan sinyaller:
//   - "!command" (komut tetikleyici)
//   - "@[agent.py]" veya whitelist'teki "*.py" adı
//   - ```tool_call ... ``` veya ```skill_call ... ``` bloğu
//   - "tool_call" / "skill_call" anahtar kelimesi (model henüz JSON yazmadıysa)
//   - aktif tools/skills/agents bağlamı + icra fiili (çalıştır, tetikle, run, fire, …)
const EXEC_VERBS_RE = /\b(?:çalıştır|calistir|tetikle|kullan|invoke|run|fire|execute|launch|spawn|trigger|call|kos|koş)\b/iu;
const EXEC_SHELL_BANG_RE = /(^|\s)!\w[\w-]*/;
const EXEC_AT_AGENT_RE = /@\[\s*[\p{L}\p{N}_\-./]+\.py\s*\]/u;
const EXEC_PY_FILENAME_RE = /\b[\p{L}\p{N}_\-]+\.py\b/u;
const EXEC_TOOLBLOCK_RE = /```(?:tool_call|skill_call)\b/i;
const EXEC_KEYWORD_RE = /\b(?:tool_call|skill_call)\b/i;

export function detectExecutionIntent(rawText, ctx = {}) {
  const text = String(rawText || "").slice(0, 4000);
  if (!text.trim()) return { execution: false, reason: null };
  if (EXEC_SHELL_BANG_RE.test(text)) return { execution: true, reason: "shell-bang" };
  if (EXEC_AT_AGENT_RE.test(text))   return { execution: true, reason: "at-agent" };
  if (EXEC_TOOLBLOCK_RE.test(text))  return { execution: true, reason: "tool-block" };
  if (EXEC_KEYWORD_RE.test(text))    return { execution: true, reason: "tool-keyword" };
  const allowed = Array.isArray(ctx.allowedAgents) ? ctx.allowedAgents : [];
  if (allowed.length) {
    for (const a of allowed) { if (a && text.includes(a)) return { execution: true, reason: "allowlisted-agent" }; }
  }
  if (EXEC_PY_FILENAME_RE.test(text)) return { execution: true, reason: "py-filename" };
  // Aktif tool/skill/agent bağlamı + icra fiili
  const hasActiveCaps = !!(ctx.toolsCount || ctx.skillsCount || ctx.agentsCount);
  if (hasActiveCaps && EXEC_VERBS_RE.test(text)) return { execution: true, reason: "verb+context" };
  return { execution: false, reason: null };
}

// --- Çekirdek: yerel Python ajanını koştur ----------------------------------
/**
 * @param {object} opts
 * @param {string} opts.script   Whitelist'li dosya adı (ör. "researcher.py")
 * @param {string} opts.query    Kullanıcı sorgusu (argv[1] olarak geçer)
 * @param {string} [opts.baseDir] Ajan dizini; default env(ELARA_AGENTS_DIR)
 * @param {number} [opts.timeoutMs] Default 60_000 ms
 * @param {string} [opts.python] Default "python3"
 * @param {object} [opts.env]    Ek env değişkenleri
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
// Allowlist runtime override: server.mjs DB hydration sonrası setAllowedAgents()
// çağrısı ile yazılır. Boş kaldığında env'e düşer (.env ELARA_AGENTS_ALLOWED).
let _runtimeAllowedAgents = null;
export function setAllowedAgents(list) {
  _runtimeAllowedAgents = Array.isArray(list)
    ? list.map((s) => String(s || "").trim()).filter(Boolean)
    : null;
}
export function getAllowedAgents() {
  if (_runtimeAllowedAgents && _runtimeAllowedAgents.length) return [..._runtimeAllowedAgents];
  // ELARA_AGENTS_ALLOWED env kaldırıldı (Tur-2). DB tek kaynak; server.mjs boot'ta
  // setAllowedAgents() çağrısı ile hydrate eder. Yine de geriye uyum için env
  // okumaya devam et — yoksa boş liste döner (hiçbir ajan koşturulamaz).
  const envList = String(process.env.ELARA_AGENTS_ALLOWED || "").split(",").map((s) => s.trim()).filter(Boolean);
  return envList;
}

// Runtime base dir override — ELARA_AGENTS_DIR boşsa DB'den hydrate edilir.
let _runtimeAgentsBaseDir = null;
export function setAgentsBaseDir(dir) {
  _runtimeAgentsBaseDir = (dir && String(dir).trim()) ? String(dir).trim() : null;
}
export function getAgentsBaseDir() {
  if (_runtimeAgentsBaseDir) return _runtimeAgentsBaseDir;
  const env = (process.env.ELARA_AGENTS_DIR || "").trim();
  return env || null;
}

export async function resolveAgentRuntime(scriptName, fallbackPython) {
  let execPython = fallbackPython || process.env.ELARA_AGENTS_PYTHON || "python3";
  let memLimitMb = null;

  if (_pool && scriptName) {
    try {
      const { rows } = await _pool.query(`
        SELECT r.python_path, r.venv_path, r.memory_mb, r.memory_auto
        FROM agents a
        LEFT JOIN runtimes r ON a.runtime_id = r.id
        WHERE a.script_path = $1 OR a.agent_path = $1 OR a.name = $1
        LIMIT 1
      `, [scriptName]);
      
      if (rows.length > 0) {
        const runtime = rows[0];
        const isWin = os.platform() === "win32";
        if (runtime.venv_path) {
          execPython = path.join(runtime.venv_path, isWin ? "Scripts" : "bin", "python");
        } else if (runtime.python_path) {
          execPython = runtime.python_path;
        }
        if (runtime.memory_auto === false && runtime.memory_mb > 0) {
          memLimitMb = runtime.memory_mb;
        }
      }
    } catch (e) {
      console.warn(`[agent-bridge] Failed to resolve runtime for ${scriptName}:`, String(e.message || e));
    }
  }

  return { execPython, memLimitMb };
}

export function buildExecutionCommand(execPython, memLimitMb, scriptAbsPath, safeQuery) {
  let cmd = execPython;
  let args = [scriptAbsPath, safeQuery];

  if (memLimitMb && os.platform() !== "win32") {
    const memKb = Math.floor(memLimitMb * 1024);
    cmd = "sh";
    args = [
      "-c",
      `ulimit -v ${memKb} && exec "$0" "$@"`,
      execPython,
      scriptAbsPath,
      safeQuery
    ];
  }

  return { cmd, args };
}

export async function runLocalAgent(opts) {
  const baseDir = opts.baseDir || getAgentsBaseDir();
  if (!baseDir) throw Object.assign(new Error("agent.empty_dir: no agents base dir (set in /api/agents or ELARA_AGENTS_DIR)"), { code: "ENOENT" });

  const allowed = getAllowedAgents();
  const scriptBase = path.basename(opts.script);
  if (allowed.length && !allowed.includes(opts.script) && !allowed.includes(scriptBase)) {
    throw new Error(`agent.denied: ${opts.script} not in allow-list`);
  }

  // Squad-prefix deduplication: if baseDir ends in <squad> (e.g. .../agents/NetSec)
  // and the script starts with the same <squad>/ prefix (e.g. NetSec/adc_maestro.py),
  // strip the redundant first segment so path.resolve doesn't produce NetSec/NetSec/.
  // Happens when hydrateAllowedAgentsFromDb picks a deeper common-prefix as baseDir
  // while meta.script is still stored squad-prefixed.
  const baseAbs = path.resolve(baseDir);
  const baseLeaf = path.basename(baseAbs);
  let scriptRel = String(opts.script || "");
  const firstSeg = scriptRel.split(/[/\\]/)[0];
  if (firstSeg && firstSeg === baseLeaf && /[\/\\]/.test(scriptRel)) {
    scriptRel = scriptRel.slice(firstSeg.length + 1);
  }

  // Path escape mührü: resolve sonrası baseDir prefix kontrolü.
  const abs = path.resolve(baseAbs, scriptRel);
  if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) {
    throw new Error(`agent.path_escape: ${opts.script}`);
  }

  const safeQuery = sanitizeQueryArg(opts.query);
  const childEnv = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
    LANG: process.env.LANG || "tr_TR.UTF-8",
    LC_ALL: process.env.LC_ALL || "tr_TR.UTF-8",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    HOME: process.env.HOME || "",
    ...(opts.env || {}),
  };

  const { execPython, memLimitMb } = await resolveAgentRuntime(opts.script, opts.python);
  const { cmd, args } = buildExecutionCommand(execPython, memLimitMb, abs, safeQuery);

  const timeoutMs = Number(opts.timeoutMs || process.env.ELARA_AGENTS_TIMEOUT_MS || QUEUE_TIMEOUTS.AGENT_EXEC_TIMEOUT_MS);

  // P1 fix (2026-05-28): Agent Python süreci MLX ${process.env.LOCAL_RUNTIME_PORT || 8001}'e openai-compat çağrı
  // atıyor. Chat hattı (server.mjs) zaten localQueue üstünden gidiyor; agent
  // de aynı slot'a girmezse paralel istek MLX'in tek aktif slot'unu kilitler
  // ("MLX modeli 60s içinde ilk token üretmedi" → zombi slot → chat felç).
  // Çözüm: execFile çağrısını AGENT_LOW önceliğiyle queue'ya teslim et.
  // Chat default=1, execution=10; agent=-1 → kullanıcı sohbeti hep öne geçer.
  const slotLabel = `agent:${scriptBase}`;
  console.error(`[agent-bridge] enqueue script=${scriptBase} memLimitMb=${memLimitMb || 'auto'} timeoutMs=${timeoutMs}`);
  const t0 = Date.now();
  const { promise: slotPromise } = localQueue.enqueue(
    async ({ signal }) => {
      // execFile shell yorumlamaz; argv array bütünsel geçer (sys.argv[1] = safeQuery).
      return execFileAsync(cmd, args, {
        cwd: baseAbs,
        env: childEnv,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 8 * 1024 * 1024,
        encoding: "utf-8",
        windowsHide: true,
        signal, // queue slot abort → child process da düşsün
      });
    },
    {
      label: slotLabel,
      priority: getAgentPriority(),
      maxWaitMs: QUEUE_TIMEOUTS.AGENT_MAX_WAIT_MS,
    },
  );
  let stdout = "", stderr = "";
  try {
    const r = await slotPromise;
    stdout = String(r.stdout || "");
    stderr = String(r.stderr || "");
    console.error(`[agent-bridge] done script=${scriptBase} elapsedMs=${Date.now() - t0} stdoutBytes=${stdout.length} stderrBytes=${stderr.length}`);
  } catch (err) {
    if (classifyAgentError(err) === "timeout") markAgentTimeoutDirty(scriptBase, timeoutMs, "agent.exec");
    console.error(`[agent-bridge] error script=${scriptBase} elapsedMs=${Date.now() - t0} code=${classifyAgentError(err)}`);
    throw err;
  }
  return { stdout, stderr };
}

// --- Streaming variant -----------------------------------------------------
// runLocalAgent (execFile) buffers ALL stdout until exit → 30+ saniye sessizlik,
// sonra "pat diye yapıştırma". streamLocalAgent spawn + 'data' event ile her
// chunk'ı onChunk(piece)'a teslim eder. localQueue slot semantiği AYNI; allowlist,
// path-escape, query sanitization aynı; sadece transport farklı.
//
// onChunk(text)  → stdout parça parça (utf-8 decode edilmiş).
// onStderr(text) → stderr parça parça (varsa).
// Resolve: { stdout, stderr, code, signal } — stdout/stderr toplu da döner ki
// caller post-stream tool-call parser çalıştırabilsin.
export async function streamLocalAgent(opts) {
  const baseDir = opts.baseDir || getAgentsBaseDir();
  if (!baseDir) throw Object.assign(new Error("agent.empty_dir: no agents base dir (set in /api/agents or ELARA_AGENTS_DIR)"), { code: "ENOENT" });

  const allowed = getAllowedAgents();
  const scriptBase = path.basename(opts.script);
  if (allowed.length && !allowed.includes(opts.script) && !allowed.includes(scriptBase)) {
    throw new Error(`agent.denied: ${opts.script} not in allow-list`);
  }

  const baseAbs = path.resolve(baseDir);
  const baseLeaf = path.basename(baseAbs);
  let scriptRel = String(opts.script || "");
  const firstSeg = scriptRel.split(/[/\\]/)[0];
  if (firstSeg && firstSeg === baseLeaf && /[\/\\]/.test(scriptRel)) {
    scriptRel = scriptRel.slice(firstSeg.length + 1);
  }
  const abs = path.resolve(baseAbs, scriptRel);
  if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) {
    throw new Error(`agent.path_escape: ${opts.script}`);
  }

  const safeQuery = sanitizeQueryArg(opts.query);
  const childEnv = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin",
    LANG: process.env.LANG || "tr_TR.UTF-8",
    LC_ALL: process.env.LC_ALL || "tr_TR.UTF-8",
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    HOME: process.env.HOME || "",
    ...(opts.env || {}),
  };

  const { execPython, memLimitMb } = await resolveAgentRuntime(opts.script, opts.python);
  const { cmd, args } = buildExecutionCommand(execPython, memLimitMb, abs, safeQuery);

  const timeoutMs = Number(opts.timeoutMs || process.env.ELARA_AGENTS_TIMEOUT_MS || QUEUE_TIMEOUTS.AGENT_EXEC_TIMEOUT_MS);
  const slotLabel = `agent:${scriptBase}`;
  const onChunk = typeof opts.onChunk === "function" ? opts.onChunk : null;
  const onStderr = typeof opts.onStderr === "function" ? opts.onStderr : null;

  console.error(`[agent-bridge] stream.enqueue script=${scriptBase} memLimitMb=${memLimitMb || 'auto'} timeoutMs=${timeoutMs}`);
  const t0 = Date.now();
  const { promise: slotPromise } = localQueue.enqueue(
    ({ signal }) => new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(cmd, args, {
          cwd: baseAbs,
          env: childEnv,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (spawnErr) { reject(spawnErr); return; }

      let stdout = "", stderr = "";
      let killedByTimeout = false;
      const tHard = setTimeout(() => {
        killedByTimeout = true;
        try { child.kill("SIGKILL"); } catch { /* */ }
      }, timeoutMs);

      const onAbort = () => {
        try { child.kill("SIGKILL"); } catch { /* */ }
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout.setEncoding("utf-8");
      child.stderr.setEncoding("utf-8");
      child.stdout.on("data", (buf) => {
        const s = String(buf || "");
        stdout += s;
        if (onChunk && s) { try { onChunk(s); } catch (e) { console.error("[agent-bridge] onChunk threw:", e?.message || e); } }
      });
      child.stderr.on("data", (buf) => {
        const s = String(buf || "");
        stderr += s;
        if (onStderr && s) { try { onStderr(s); } catch { /* */ } }
      });
      child.on("error", (err) => {
        clearTimeout(tHard);
        if (signal) try { signal.removeEventListener("abort", onAbort); } catch { /* */ }
        reject(err);
      });
      child.on("close", (code, sig) => {
        clearTimeout(tHard);
        if (signal) try { signal.removeEventListener("abort", onAbort); } catch { /* */ }
        if (killedByTimeout) {
          markAgentTimeoutDirty(scriptBase, timeoutMs, "agent.stream");
          const err = new Error(`agent.timeout: ${scriptBase} exceeded ${timeoutMs}ms`);
          err.killed = true; err.signal = "SIGKILL";
          reject(err);
          return;
        }
        if (code !== 0 && code != null) {
          const err = new Error(`agent.exit_nonzero: ${scriptBase} code=${code}`);
          err.code = code;
          err.stdout = stdout; err.stderr = stderr;
          reject(err);
          return;
        }
        resolve({ stdout, stderr, code, signal: sig });
      });
    }),
    {
      label: slotLabel,
      priority: getAgentPriority(),
      maxWaitMs: QUEUE_TIMEOUTS.AGENT_MAX_WAIT_MS,
    },
  );

  try {
    const r = await slotPromise;
    console.error(`[agent-bridge] stream.done script=${scriptBase} elapsedMs=${Date.now() - t0} stdoutBytes=${r.stdout.length} stderrBytes=${r.stderr.length}`);
    return r;
  } catch (err) {
    console.error(`[agent-bridge] stream.error script=${scriptBase} elapsedMs=${Date.now() - t0} code=${classifyAgentError(err)}`);
    throw err;
  }
}

// --- Param coercion (Şema prangalarını kır) ---------------------------------
/**
 * Free-form metin girdisini schema'nın string alanına otomatik sarmallar.
 * Kullanım: validateAgainstSchema'dan ÖNCE çağır.
 *
 * @param {object|null|undefined} schema  JSON-Schema subset
 * @param {object|null|undefined} rawParams Mevcut param objesi
 * @param {string|null|undefined} rawTextInput Chat'ten gelen serbest metin
 * @returns {object} Sarmallanmış params
 */
export function coerceParams(schema, rawParams, rawTextInput) {
  const params = (rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) ? { ...rawParams } : {};
  const text = (rawTextInput == null || rawTextInput === "") ? "" : String(rawTextInput).trim();
  if (!text) return params;

  // Schema yoksa default: { query: text }
  if (!schema || typeof schema !== "object" || !schema.properties) {
    if (params.query === undefined && params.input === undefined && params.text === undefined && params.prompt === undefined) {
      params.query = text;
    }
    return params;
  }

  const props = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  // Hedef alanı seç: öncelik query → input → text → prompt → ilk required string → ilk string property
  const PREFERRED = ["query", "input", "text", "prompt", "q"];
  let target = null;
  for (const k of PREFERRED) {
    if (props[k] && (props[k].type === "string" || props[k].type === undefined)) { target = k; break; }
  }
  if (!target) {
    for (const k of required) {
      if (props[k] && (props[k].type === "string" || props[k].type === undefined)) { target = k; break; }
    }
  }
  if (!target) {
    for (const k of Object.keys(props)) {
      if (props[k] && (props[k].type === "string" || props[k].type === undefined)) { target = k; break; }
    }
  }

  if (target && (params[target] === undefined || params[target] === null || params[target] === "")) {
    params[target] = text;
  }
  return params;
}
