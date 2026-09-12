// lib/policy-engine-eval.mjs — Enterprise Policy Engine Evaluation Core
// Evaluates top-down ROUTING/OUTPUT chain rules for dynamic model switching, spending limits, and policy challenges.

/**
 * Matches a boolean expression clause (e.g. "intent = coding and cost < 5" or "always")
 */
export function matchPolicyCondition(expr, ctx) {
  const source = String(expr || "").trim();
  if (!source) return null;

  const clauses = source
    .split(/\s+and\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    if (/^always$/i.test(clause)) continue;

    const m = clause.match(/^([a-z_]+)\s*(>=|<=|!=|=|>|<|contains|matches)\s*(.+)$/i);
    if (!m) return null;

    const field = String(m[1] || "").toLowerCase();
    const op = String(m[2] || "").toLowerCase();
    const rawValue = String(m[3] || "").trim().replace(/^["'/]|["'/]$/g, "");

    let strValue = "";
    if (field === "text" || field === "prompt") strValue = ctx.text || "";
    else if (field === "output" || field === "response") strValue = ctx.output || "";
    else if (field === "intent") strValue = ctx.intent || "";
    else if (field === "target" || field === "model") strValue = ctx.target || "";
    else if (field === "cost") strValue = String(ctx.cost ?? 0);
    else strValue = "";

    let ok = false;
    if (op === "contains") {
      ok = strValue.toLowerCase().includes(rawValue.toLowerCase());
    } else if (op === "matches") {
      try {
        const re = new RegExp(rawValue, "i");
        ok = re.test(strValue);
      } catch {
        ok = false;
      }
    } else if (op === "=") {
      ok = strValue.toLowerCase() === rawValue.toLowerCase();
    } else if (op === "!=") {
      ok = strValue.toLowerCase() !== rawValue.toLowerCase();
    } else {
      const left = Number(strValue);
      const right = Number(rawValue);
      if (Number.isNaN(left) || Number.isNaN(right)) return null;
      if (op === ">") ok = left > right;
      else if (op === "<") ok = left < right;
      else if (op === ">=") ok = left >= right;
      else if (op === "<=") ok = left <= right;
    }

    if (!ok) return null;
  }

  return `Matched condition: ${source}`;
}

/**
 * Basic heuristic intent classifier for prompt evaluation.
 */
export function inferPromptIntent(text = "") {
  const t = text.toLowerCase();
  if (/\b(code|function|class|def|python|javascript|typescript|bug|error|refactor|sql|query|select|table|dag|workflow|api)\b/i.test(t)) {
    return "coding";
  }
  if (/\b(finance|invoice|price|cost|billing|tariffs|tokens)\b/i.test(t)) {
    return "billing";
  }
  if (/\b(search|find|lookup|who is|what is|latest news)\b/i.test(t)) {
    return "search";
  }
  return "general";
}

/**
 * Extracts target model / agent ID from action parameter (e.g. "route -> qwen2.5-coder" -> "qwen2.5-coder").
 */
export function extractRouteTarget(actionParam = "") {
  const raw = String(actionParam).trim();
  const cleaned = raw.replace(/^route\s*(->|→|=)\s*/i, "").trim();
  return cleaned || raw;
}

/**
 * Evaluates active Policy Rules from PostgreSQL against current chat request.
 */
export async function evaluatePolicyRules({ pool, promptText = "", requestedModel = "default", cost = 0, tenantId = "default" }) {
  try {
    const { rows: rules } = await pool.query(
      `SELECT * FROM policy_rules 
       WHERE enabled = true 
         AND (tenant_id = $1 OR is_global = true OR tenant_id = 'default')
       ORDER BY seq ASC, created_at ASC`,
      [tenantId || "default"]
    ).catch(() => ({ rows: [] }));

    if (!rules.length) {
      return { matched: false, action: "allow" };
    }

    const intent = inferPromptIntent(promptText);
    const evalCtx = {
      text: promptText,
      output: "",
      intent,
      target: requestedModel,
      cost,
    };

    for (const rule of rules) {
      const reason = matchPolicyCondition(rule.if_condition, evalCtx);
      if (reason) {
        const action = String(rule.action || "allow").toLowerCase();
        const target = extractRouteTarget(rule.then_action);

        return {
          matched: true,
          rule,
          seq: rule.seq || 10,
          name: rule.name || `Rule #${rule.seq}`,
          action,
          target,
          reason,
        };
      }
    }
  } catch (err) {
    console.warn("[PolicyEngine] Evaluation notice:", err.message);
  }

  return { matched: false, action: "allow" };
}
