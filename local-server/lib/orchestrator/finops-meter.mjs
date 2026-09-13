// local-server/lib/orchestrator/finops-meter.mjs
// FinOps Token Accounting, Cost Calculation & Telemetry Persistence for ELARA Sovereign Studio.

export function calculateTurnTokens({ formattedMessages, assembled, assembledThinking, approxTokens }) {
  const promptText = formattedMessages
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");

  const promptTokens = approxTokens
    ? approxTokens(promptText)
    : Math.max(1, Math.round(promptText.length / 4));

  const responseText = (assembled || "") + (assembledThinking || "");
  const responseTokens = approxTokens
    ? approxTokens(responseText)
    : Math.max(1, Math.round(responseText.length / 4));

  const totalTokens = promptTokens + responseTokens;
  return { promptTokens, responseTokens, totalTokens };
}

export function calculateTurnCost({ promptTokens, responseTokens, finalProviderUsed }) {
  const inputRate = Number(finalProviderUsed?.input_cost || 0);
  const outputRate = Number(finalProviderUsed?.output_cost || 0);
  const costUsd = Number(
    (promptTokens * (inputRate / 1_000_000) + responseTokens * (outputRate / 1_000_000)).toFixed(6)
  );
  return costUsd;
}

export async function persistTurnTelemetry({
  pool,
  thread_id,
  agent_id,
  finalProviderUsed,
  promptTokens,
  responseTokens,
  totalTokens,
  totalMs,
  costUsd,
  usedModelStr,
  sourceNameStr,
  provId,
  assembled,
}) {
  // 1. Persist working memory block for thread persistence
  if (thread_id) {
    try {
      const snippet = (assembled || "").substring(0, 45).replace(/\n/g, " ") + "...";
      const memTokens = totalTokens;
      const memId = `wrk.${Math.random().toString(36).slice(2, 8)}`;
      const memLabel = agent_id ? `Agent response: ${snippet}` : `Model response: ${snippet}`;
      const memTone = agent_id ? "emerald" : "sapphire";

      await pool.query(
        `INSERT INTO chat_threads (id, title) VALUES ($1, 'New chat') ON CONFLICT (id) DO NOTHING`,
        [thread_id]
      );

      await pool.query(
        `INSERT INTO memory_working (id, thread_id, label, origin, tokens, tone, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, false)`,
        [memId, thread_id, memLabel, usedModelStr, memTokens, memTone]
      );
    } catch (memErr) {
      console.error("[FinOps] Failed to record working memory:", memErr.message);
    }
  }

  // 2. Persist provider_usage for FinOps & Usage reporting
  try {
    await pool.query(
      `INSERT INTO provider_usage (
         provider_id, provider_name, kind, model, thread_id,
         prompt_tokens, response_tokens, total_tokens, latency_ms, status,
         hallucination_score, groundedness_score, refusal_rate, cache_hits, cost_usd
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        provId,
        sourceNameStr,
        "llm",
        usedModelStr,
        thread_id || null,
        promptTokens,
        responseTokens,
        totalTokens,
        totalMs,
        "ok",
        0,
        100,
        0,
        0,
        costUsd,
      ]
    );
  } catch (usageErr) {
    console.warn("[FinOps] Telemetry provider_usage insert notice:", usageErr.message);
  }
}
