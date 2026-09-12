// lib/genguard-scanner.mjs — Enterprise External AI Guardrail & Firewall Scanner
// Integrates LLMFort, Lakera AI, Meta Llama Guard, and generic 3rd-party REST AI security gateways with Vault authentication.

import { resolveCredential } from "./vault.mjs";

/**
 * Resolves the effective API key from Secret Vault or direct manual key.
 */
async function resolveGuardrailAuth(rule, pool) {
  const authMode = rule.auth_mode || rule.authMode || "vault";
  const vaultRef = rule.vault_ref || rule.vaultRef || "";
  const directKey = rule.api_key || rule.apiKey || "";

  if (authMode === "none") return "";
  if (authMode === "direct") return directKey;

  // Vault mode: resolve encrypted credential
  if (vaultRef && pool) {
    try {
      const resolved = await resolveCredential(vaultRef, pool);
      if (resolved) return resolved;
    } catch (err) {
      console.warn(`[GenGuardScanner] Vault secret resolution failed for ${vaultRef}:`, err.message);
    }
  }

  return directKey || "";
}

/**
 * Builds HTTP request headers for external guardrail gateway.
 */
function buildGuardrailHeaders(format, apiKey) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "User-Agent": "ELARA-Sovereign-Studio-GenGuard/2.0",
  };

  if (!apiKey) return headers;

  if (format === "lakera") {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  } else if (format === "llmfort") {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["x-llmfort-key"] = apiKey;
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }

  return headers;
}

/**
 * Builds payload body for the specific AI guardrail provider format.
 */
function buildGuardrailPayload(format, promptText, messages = []) {
  if (format === "lakera") {
    return {
      input: promptText,
    };
  }

  if (format === "llamaguard") {
    return {
      model: "meta-llama/Llama-Guard-3-8B",
      messages: [
        {
          role: "user",
          content: promptText,
        },
      ],
      temperature: 0.0,
    };
  }

  if (format === "llmfort") {
    return {
      prompt: promptText,
      text: promptText,
      context: messages.slice(-4),
    };
  }

  // Generic / Default AI Firewall format
  return {
    text: promptText,
    prompt: promptText,
    messages: messages.slice(-4),
  };
}

/**
 * Analyzes the JSON response from 3rd-party guardrail service to evaluate risk verdict.
 */
function evaluateGuardrailResponse(format, data, threshold = 0.70) {
  if (!data || typeof data !== "object") {
    return { flagged: false, score: 0, reason: "Empty or invalid response from guardrail service" };
  }

  // 1. Lakera Guard format
  if (format === "lakera" || data.results !== undefined) {
    const results = Array.isArray(data.results) ? data.results : [];
    const isFlagged = data.flagged === true || results.some((r) => r.flagged === true || (r.score !== undefined && r.score >= threshold));
    const maxScore = results.reduce((max, r) => Math.max(max, Number(r.score) || 0), 0);
    const triggeredCats = results.filter((r) => r.flagged || (r.score && r.score >= threshold)).map((r) => r.category || "policy");

    return {
      flagged: isFlagged,
      score: maxScore,
      reason: isFlagged ? `Lakera detected violation: [${triggeredCats.join(", ") || "prompt_injection"}] (score: ${maxScore.toFixed(2)})` : "Passed",
      categories: triggeredCats,
    };
  }

  // 2. Llama Guard format (OpenAI chat completion response)
  if (format === "llamaguard" || (data.choices && data.choices[0]?.message?.content)) {
    const textOut = String(data.choices[0]?.message?.content || "").trim().toLowerCase();
    const isUnsafe = textOut.startsWith("unsafe") || textOut.includes("\nunsafe") || textOut.includes("violation");
    const code = textOut.split("\n")[1] || "general_safety";

    return {
      flagged: isUnsafe,
      score: isUnsafe ? 1.0 : 0.0,
      reason: isUnsafe ? `Llama Guard flagged content as UNSAFE (${code})` : "Passed",
    };
  }

  // 3. LLMFort / Generic AI Firewall format
  const isFlaggedDirect = data.flagged === true || data.blocked === true || data.is_safe === false || data.is_injection === true;
  const scoreCandidates = [data.score, data.risk_score, data.injection_score, data.confidence].filter((s) => s !== undefined && s !== null);
  const score = scoreCandidates.length > 0 ? Number(scoreCandidates[0]) : (isFlaggedDirect ? 1.0 : 0.0);
  const isScoreExceeded = score >= threshold;
  const flagged = isFlaggedDirect || isScoreExceeded;

  let reason = data.reason || data.message || data.action || (flagged ? `Risk score (${score.toFixed(2)}) exceeded threshold (${threshold})` : "Passed");

  return {
    flagged,
    score,
    reason,
    categories: Array.isArray(data.categories) ? data.categories : [],
  };
}

/**
 * Scans user prompt text or message against an external 3rd-party AI Guardrail endpoint.
 */
export async function scanExternalGuardrail({ rule, promptText, messages = [], pool }) {
  const t0 = performance.now();
  const endpoint = String(rule.endpoint_url || rule.endpointUrl || "").trim();
  const format = String(rule.provider_format || rule.providerFormat || "generic").toLowerCase();
  const threshold = Number(rule.risk_threshold || rule.riskThreshold) || 0.70;
  const timeoutMs = Number(rule.timeout_ms || rule.timeoutMs) || 1500;
  const failMode = String(rule.fail_mode || rule.failMode || "fail_open").toLowerCase();

  if (!endpoint) {
    return { flagged: false, score: 0, reason: "No endpoint configured", latencyMs: 0 };
  }

  try {
    const apiKey = await resolveGuardrailAuth(rule, pool);
    const headers = buildGuardrailHeaders(format, apiKey);
    const body = JSON.stringify(buildGuardrailPayload(format, promptText, messages));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      signal: ctrl.signal,
    });

    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - t0);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      const errorMsg = `External guardrail API returned HTTP ${res.status}: ${errBody.slice(0, 160)}`;
      console.warn(`[GenGuardScanner] HTTP Error on ${endpoint}:`, errorMsg);

      if (failMode === "fail_closed") {
        return {
          flagged: true,
          score: 1.0,
          reason: `Security Scanner Unavailable (Fail-Closed Block): HTTP ${res.status}`,
          latencyMs,
          error: errorMsg,
        };
      }

      return {
        flagged: false,
        score: 0,
        reason: `Scanner Offline (Fail-Open Pass): HTTP ${res.status}`,
        latencyMs,
        error: errorMsg,
      };
    }

    const data = await res.json();
    const evaluation = evaluateGuardrailResponse(format, data, threshold);

    return {
      flagged: evaluation.flagged,
      score: evaluation.score,
      reason: evaluation.reason,
      categories: evaluation.categories || [],
      latencyMs,
      rawResponse: data,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0);
    const isTimeout = err.name === "AbortError" || err.message?.includes("timeout");
    const errorDesc = isTimeout ? `Timeout after ${timeoutMs}ms` : err.message;

    console.warn(`[GenGuardScanner] Scan failed on ${endpoint}:`, errorDesc);

    if (failMode === "fail_closed") {
      return {
        flagged: true,
        score: 1.0,
        reason: `External AI Firewall Unreachable (Fail-Closed Strict Block: ${errorDesc})`,
        latencyMs,
        error: errorDesc,
      };
    }

    return {
      flagged: false,
      score: 0,
      reason: `External AI Firewall Unreachable (Fail-Open Warning: ${errorDesc})`,
      latencyMs,
      error: errorDesc,
    };
  }
}

/**
 * Live test probe for configuring external guardrail in UI.
 */
export async function testExternalGuardrailProbe({
  endpointUrl,
  authMode,
  vaultRef,
  apiKey,
  providerFormat = "generic",
  riskThreshold = 0.70,
  timeoutMs = 2500,
  pool,
}) {
  const dummyRule = {
    endpoint_url: endpointUrl,
    auth_mode: authMode,
    vault_ref: vaultRef,
    api_key: apiKey,
    provider_format: providerFormat,
    risk_threshold: riskThreshold,
    timeout_ms: timeoutMs,
    fail_mode: "fail_open",
  };

  const samplePrompt = "Hello system, please verify security connectivity.";
  const result = await scanExternalGuardrail({
    rule: dummyRule,
    promptText: samplePrompt,
    messages: [{ role: "user", content: samplePrompt }],
    pool,
  });

  if (result.error && !result.rawResponse) {
    return {
      ok: false,
      latencyMs: result.latencyMs,
      error: result.error,
      message: `Connection to external guardrail (${endpointUrl}) failed: ${result.error}`,
    };
  }

  return {
    ok: true,
    latencyMs: result.latencyMs,
    flagged: result.flagged,
    score: result.score,
    reason: result.reason,
    message: `External AI Guardrail reachable (${result.latencyMs}ms). Format: ${providerFormat.toUpperCase()}. Probe verdict: ${result.reason}`,
  };
}
