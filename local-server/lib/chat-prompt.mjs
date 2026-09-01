// chat-prompt.mjs — thin wrapper around lib/chat-templates.mjs (single registry).
//
// 2026-06-02 — Aile listesi ARTIK BURADA DEĞİL. Tek mercii lib/chat-templates.mjs.
// Bu modül public API (`renderChatPrompt`, `toCompletionBody`, `CHAT_TEMPLATE_FAMILY`)
// koruyor; server.mjs ve call-site'lar dokunulmuyor.

import { renderFamily, FAMILIES, ALLOWED_FAMILY_IDS } from "./chat-templates.mjs";

const DEFAULT_FAMILY = String(process.env.LLM_CHAT_TEMPLATE || "qwen2.5").toLowerCase();

/**
 * renderChatPrompt
 * @param {Array<{role:string, content:string}>} messages
 * @param {{template?: string, prefix?: string, extraStop?: string[]}} [opts]
 * @returns {{ prompt: string, stopSequences: string[] }}
 */
export function renderChatPrompt(messages, opts = {}) {
  const family = opts.template || DEFAULT_FAMILY;
  const kwargs = (opts && opts.kwargs && typeof opts.kwargs === "object" && !Array.isArray(opts.kwargs)) ? opts.kwargs : undefined;
  const rendered = renderFamily(family, messages, kwargs);
  let prompt = rendered.prompt;
  if (opts.prefix && typeof opts.prefix === "string") {
    prompt = `${opts.prefix}\n${prompt}`;
  }
  const stopSet = new Set(rendered.stopSequences);
  if (Array.isArray(opts.extraStop)) {
    for (const s of opts.extraStop) if (s) stopSet.add(s);
  }
  return { prompt, stopSequences: Array.from(stopSet) };
}


/**
 * Convert a messages-based MLX chat body into a text-completion body.
 * Keeps every other key (model, max_tokens, temperature, top_p, stop, ...)
 * intact. Removes chat-only keys that /v1/completions doesn't understand.
 *
 * @param {object} body
 * @param {object} [opts]
 * @returns {object}
 */
export function toCompletionBody(body, opts = {}) {
  if (!body || typeof body !== "object") return body;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const callerKwargs = (body.chat_template_kwargs && typeof body.chat_template_kwargs === "object" && !Array.isArray(body.chat_template_kwargs)) ? body.chat_template_kwargs : null;
  const optsKwargs = (opts && opts.kwargs && typeof opts.kwargs === "object" && !Array.isArray(opts.kwargs)) ? opts.kwargs : null;
  // Per-call body.chat_template_kwargs wins over model-row opts.kwargs so
  // smalltalk/disableThink overrides keep working.
  const effectiveKwargs = (callerKwargs || optsKwargs)
    ? { ...(optsKwargs || {}), ...(callerKwargs || {}) }
    : null;
  const renderOpts = effectiveKwargs ? { ...opts, kwargs: effectiveKwargs } : opts;
  const { prompt, stopSequences } = renderChatPrompt(messages, renderOpts);
  const next = { ...body };
  delete next.messages;
  if (effectiveKwargs) next.chat_template_kwargs = effectiveKwargs;
  else delete next.chat_template_kwargs;
  next.prompt = prompt;
  const callerStop = Array.isArray(body.stop) ? body.stop : (body.stop ? [body.stop] : []);
  const merged = Array.from(new Set([...stopSequences, ...callerStop])).slice(0, 8);
  if (merged.length > 0) next.stop = merged;
  return next;
}


export const CHAT_TEMPLATE_FAMILY = DEFAULT_FAMILY;

// Re-exports for callers that want the canonical list.
export { FAMILIES, ALLOWED_FAMILY_IDS };
