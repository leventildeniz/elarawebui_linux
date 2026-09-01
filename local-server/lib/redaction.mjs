// Faz 7 — Secret / PII redaction
// Mask high-risk strings BEFORE they hit chat history, agent_logs,
// workflow_steps, tool_invocations, trace/debug exports and backups.
//
// Design notes:
//   - Vault keeps secrets safe at rest. Redaction keeps secrets from leaking
//     into anything that gets persisted, displayed, exported, or shipped.
//   - We mask, we do NOT decrypt or store the raw. Once masked here, the
//     original is unrecoverable from the log/trace path.
//   - Pattern set is intentionally aggressive: better to over-redact a noisy
//     log than to leak a Fortinet API token into a backup file.

const PLACEHOLDER = "[REDACTED]";

// Order matters — most specific first so generic catch-alls don't blur context.
const PATTERNS = [
  // PEM blocks (private keys, certs with sensitive headers)
  { name: "pem_private_key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g },
  // SSH private keys (single-line fallthrough)
  { name: "ssh_private", re: /ssh-(?:rsa|ed25519|dss|ecdsa)\s+[A-Za-z0-9+/=]{40,}(?:\s+\S+)?/g },
  // Authorization: Bearer / Basic / Token / OAuth
  { name: "auth_header", re: /\b(authorization\s*[:=]\s*)(bearer|basic|token|oauth)\s+[A-Za-z0-9._\-+/=]{8,}/gi, replace: (_m, p1) => `${p1}${PLACEHOLDER}` },
  // Cookie: name=value;... — mask the values
  { name: "cookie_header", re: /\b(cookie\s*[:=]\s*)([^\r\n]+)/gi, replace: (_m, p1) => `${p1}${PLACEHOLDER}` },
  // Fortinet API token query / header (api_key=…, access_token=…)
  { name: "fortinet_token", re: /\b(api[_-]?key|access[_-]?token|fortitoken|token|secret|password|passwd|pwd)\s*[:=]\s*["']?([A-Za-z0-9._\-+/=]{6,})["']?/gi, replace: (_m, p1) => `${p1}=${PLACEHOLDER}` },
  // JWT (three base64url segments)
  { name: "jwt", re: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/g },
  // AWS access key id / secret pair
  { name: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "aws_secret", re: /\b(aws_secret_access_key|aws[_-]?secret)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi, replace: (_m, p1) => `${p1}=${PLACEHOLDER}` },
  // GitHub / GitLab personal access tokens
  { name: "github_pat", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: "glpat", re: /\bglpat-[A-Za-z0-9_\-]{20,}\b/g },
  // Slack / Stripe / OpenAI style prefixes
  { name: "slack", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "stripe", re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "openai", re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  // Generic long hex/base64 secrets after secret-like keywords (last resort)
  { name: "generic_secret_kv", re: /\b(secret|api[_-]?key|token|passwd|password|auth)\s*["']?\s*[:=]\s*["']?([A-Za-z0-9._\-+/=]{16,})["']?/gi, replace: (_m, p1) => `${p1}=${PLACEHOLDER}` },
];

const SENSITIVE_KEY_RE = /(pass(word|wd)?|secret|token|api[_-]?key|auth|cookie|session|bearer|private[_-]?key|access[_-]?key|client[_-]?secret|refresh[_-]?token|fortitoken)/i;

/** Redact a single string. Returns the string unchanged if no match. */
export function redactString(str) {
  if (typeof str !== "string" || str.length === 0) return str;
  let out = str;
  for (const p of PATTERNS) {
    if (p.replace) out = out.replace(p.re, p.replace);
    else out = out.replace(p.re, PLACEHOLDER);
  }
  return out;
}

/** Deep-redact arbitrary JSON-ish input. Keys hinting at secrets get masked
 *  entirely; string leaves get pattern-redacted. Non-cyclic structures only. */
export function redactDeep(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(k) && v != null && typeof v !== "object") {
      out[k] = PLACEHOLDER;
    } else {
      out[k] = redactDeep(v, seen);
    }
  }
  return out;
}

/** True when the value (string or object) looks like it contains a secret. */
export function looksSensitive(value) {
  if (value == null) return false;
  if (typeof value === "string") return redactString(value) !== value;
  try { return JSON.stringify(redactDeep(value)) !== JSON.stringify(value); }
  catch { return false; }
}

export const REDACTION_PLACEHOLDER = PLACEHOLDER;
