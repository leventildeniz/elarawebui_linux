// chat-templates.mjs — SINGLE SOURCE OF TRUTH for chat template families.
//
// 2026-06-02 — Bu modül 3 katmanın tek mercii olmak için kuruldu:
//   1. lib/chat-prompt.mjs  (JS Yol C renderer)         → re-export from here
//   2. agents/_shared/mlx_runner.py  (Python agent runner) → mirror impl. (parite)
//   3. UI /system-engine → Models editör Chat Template dropdown → /api/system/chat-templates endpoint'inden besler
//
// Kural: yeni aile eklemek = (a) FAMILIES'e ekle (b) mlx_runner.py'a mirror yaz (c) smoke-chat-templates.sh patches.
// Sessiz fallback YASAK — bilinmeyen family → renderFamily() throw eder; /api/models POST reddeder.
//
// Kapsam (9 aile):
//   - qwen2.5  : ChatML; Qwen2/Qwen2.5/Qwen3 + generic ChatML (DeepSeek-R1 ChatML mod dahil)
//   - chatml   : qwen2.5 alias
//   - llama3   : Llama 3 / 3.1 / 3.2 / 3.3 + DeepSeek-R1-Distill-Llama
//   - mistral  : Mistral v3 Tekken ([INST]...[/INST])
//   - gemma    : Gemma 2/3 (no system role; <start_of_turn>)
//   - deepseek : DeepSeek V2/V3 native template (<｜begin▁of▁sentence｜>)
//   - phi      : Microsoft Phi-3/3.5/4 (<|user|>...<|end|><|assistant|>)
//   - command-r: Cohere Command-R/R+ (<|START_OF_TURN_TOKEN|><|USER_TOKEN|>)
//   - yi       : 01.AI Yi-1.5 / Yi-Coder (ChatML-like with Yi-specific stops)
//   - raw      : Deneysel [role] düz birleştirme

function _collapseMessages(messages) {
  const out = [];
  for (const m of (Array.isArray(messages) ? messages : [])) {
    if (!m || typeof m !== "object") continue;
    const role = String(m.role || "user").toLowerCase();
    const content = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((c) => (typeof c === "string" ? c : (c?.text || ""))).join("")
        : String(m.content ?? "");
    if (!content) continue;
    out.push({ role, content });
  }
  return out;
}

// Each renderer: (msgs) => { prompt: string, stopSequences: string[] }
const _renderQwen = (msgs) => {
  let s = "";
  for (const m of msgs) s += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  s += "<|im_start|>assistant\n";
  return { prompt: s, stopSequences: ["<|im_end|>", "<|endoftext|>", "<|im_start|>"] };
};

const _renderLlama3 = (msgs) => {
  let s = "<|begin_of_text|>";
  for (const m of msgs) s += `<|start_header_id|>${m.role}<|end_header_id|>\n\n${m.content}<|eot_id|>`;
  s += "<|start_header_id|>assistant<|end_header_id|>\n\n";
  return { prompt: s, stopSequences: ["<|eot_id|>", "<|end_of_text|>", "<|start_header_id|>"] };
};

const _renderMistral = (msgs) => {
  let s = "<s>";
  let pendingSystem = "";
  let openInst = false;
  for (const m of msgs) {
    if (m.role === "system") { pendingSystem = pendingSystem ? `${pendingSystem}\n\n${m.content}` : m.content; continue; }
    if (m.role === "user") {
      const userText = pendingSystem ? `${pendingSystem}\n\n${m.content}` : m.content;
      pendingSystem = "";
      s += `[INST] ${userText} [/INST]`;
      openInst = true;
    } else if (m.role === "assistant") {
      s += ` ${m.content}</s>`;
      openInst = false;
    }
  }
  if (!openInst && pendingSystem) s += `[INST] ${pendingSystem} [/INST]`;
  return { prompt: s, stopSequences: ["</s>", "[INST]"] };
};

const _renderGemma = (msgs) => {
  let s = "";
  let pendingSystem = "";
  let openUser = false;
  for (const m of msgs) {
    if (m.role === "system") { pendingSystem = pendingSystem ? `${pendingSystem}\n\n${m.content}` : m.content; continue; }
    if (m.role === "user") {
      const userText = pendingSystem ? `${pendingSystem}\n\n${m.content}` : m.content;
      pendingSystem = "";
      s += `<start_of_turn>user\n${userText}<end_of_turn>\n`;
      openUser = true;
    } else if (m.role === "assistant") {
      s += `<start_of_turn>model\n${m.content}<end_of_turn>\n`;
      openUser = false;
    }
  }
  if (!openUser && pendingSystem) s += `<start_of_turn>user\n${pendingSystem}<end_of_turn>\n`;
  s += "<start_of_turn>model\n";
  return { prompt: s, stopSequences: ["<end_of_turn>", "<eos>"] };
};

const _renderDeepSeek = (msgs) => {
  // DeepSeek V2/V3 native. System mesajı en başa düz prepend, diğerleri
  // <｜User｜> ve <｜Assistant｜> token'ları ile sarılır. Unicode token'lar
  // tokenizer.json içinde tek karakter olarak işaretli — string olarak gönder.
  let s = "<\uff5cbegin\u2581of\u2581sentence\uff5c>";
  let pendingSystem = "";
  for (const m of msgs) {
    if (m.role === "system") { pendingSystem = pendingSystem ? `${pendingSystem}\n\n${m.content}` : m.content; continue; }
    if (pendingSystem) { s += pendingSystem; pendingSystem = ""; }
    if (m.role === "user") s += `<\uff5cUser\uff5c>${m.content}`;
    else if (m.role === "assistant") s += `<\uff5cAssistant\uff5c>${m.content}<\uff5cend\u2581of\u2581sentence\uff5c>`;
  }
  if (pendingSystem) s += pendingSystem;
  s += "<\uff5cAssistant\uff5c>";
  return { prompt: s, stopSequences: ["<\uff5cend\u2581of\u2581sentence\uff5c>", "<\uff5cUser\uff5c>"] };
};

const _renderPhi = (msgs) => {
  // Microsoft Phi-3 / 3.5 / 4. system|user|assistant rolleri ayrı.
  let s = "";
  for (const m of msgs) {
    if (m.role === "system") s += `<|system|>\n${m.content}<|end|>\n`;
    else if (m.role === "user") s += `<|user|>\n${m.content}<|end|>\n`;
    else if (m.role === "assistant") s += `<|assistant|>\n${m.content}<|end|>\n`;
  }
  s += "<|assistant|>\n";
  return { prompt: s, stopSequences: ["<|end|>", "<|endoftext|>", "<|user|>"] };
};

const _renderCommandR = (msgs) => {
  // Cohere Command-R / R+. SYSTEM | USER | CHATBOT preamble system.
  let s = "<BOS_TOKEN>";
  for (const m of msgs) {
    const tok = m.role === "system" ? "SYSTEM_TOKEN"
              : m.role === "user" ? "USER_TOKEN"
              : "CHATBOT_TOKEN";
    s += `<|START_OF_TURN_TOKEN|><|${tok}|>${m.content}<|END_OF_TURN_TOKEN|>`;
  }
  s += "<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>";
  return { prompt: s, stopSequences: ["<|END_OF_TURN_TOKEN|>", "<|START_OF_TURN_TOKEN|>"] };
};

const _renderYi = (msgs) => {
  // 01.AI Yi-1.5 / Yi-Coder. ChatML-like; ek stop = </s> (Yi tokenizer)
  let s = "";
  for (const m of msgs) s += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  s += "<|im_start|>assistant\n";
  return { prompt: s, stopSequences: ["<|im_end|>", "<|endoftext|>", "</s>"] };
};

const _renderRaw = (msgs) => {
  const s = msgs.map((m) => `[${m.role}]\n${m.content}`).join("\n\n") + "\n\n[assistant]\n";
  return { prompt: s, stopSequences: ["\n[user]", "\n[system]"] };
};

// Gemma 4 — native <|turn> / <|channel> protocol (NOT ChatML).
// Mirrors chat_template.jinja shipped with google/gemma-4-* checkpoints.
// enable_thinking resolution (highest → lowest):
//   1) per-request kwargs.enable_thinking  (UI Switch: model row OR agent meta)
//   2) env ELARA_LLM_CHAT_TEMPLATE_KWARGS JSON
//   3) default FALSE (off-by-default — user opens via UI Switch only).
function _gemma4ThinkingEnabled(kwargs) {
  if (kwargs && typeof kwargs === "object" && "enable_thinking" in kwargs) {
    return Boolean(kwargs.enable_thinking);
  }
  const raw = String(process.env.ELARA_LLM_CHAT_TEMPLATE_KWARGS || "").trim();
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === "object" && "enable_thinking" in o) return Boolean(o.enable_thinking);
    } catch { /* ignore */ }
  }
  return false;
}

const _renderGemma4 = (msgs, ctx) => {
  const kwargs = (ctx && typeof ctx === "object" && ctx.kwargs && typeof ctx.kwargs === "object") ? ctx.kwargs : null;
  const enableThinking = _gemma4ThinkingEnabled(kwargs);
  let s = "<bos>";
  // Coalesce ALL leading/consecutive system messages into ONE system turn.
  // Prior behavior only kept msgs[0], silently dropping any additional system
  // messages (e.g. META-FORGE hint prepended before the base KİMLİK prompt).
  const systemParts = [];
  let idx = 0;
  while (idx < msgs.length && msgs[idx].role === "system") {
    const t = String(msgs[idx].content || "").trim();
    if (t) systemParts.push(t);
    idx += 1;
  }
  const systemText = systemParts.join("\n\n");
  const rest = msgs.slice(idx);
  if (systemText || enableThinking) {
    s += "<|turn>system\n";
    if (enableThinking) s += "<|think|>\n";
    if (systemText) s += systemText;
    s += "<turn|>\n";
  }
  for (const m of rest) {
    let role = m.role || "user";
    if (role === "assistant") role = "model";
    // Any stray in-conversation system message (rare) becomes an inline user
    // instruction so the model still sees it instead of dropping to a new turn.
    if (role === "system") role = "user";
    let content = String(m.content || "");
    if (role === "user") content = content.trim();
    s += `<|turn>${role}\n${content}<turn|>\n`;
  }
  s += "<|turn>model\n";
  // Gemma 4's shipped tokenizer template seeds an empty thought channel when
  // thinking is disabled:
  //   <|turn>model\n<|channel>thought\n<channel|>
  // Without this channel marker, the native Gemma 4 protocol is incomplete and
  // the first token can stall even for trivial smalltalk after a clean reboot.
  if (!enableThinking) s += "<|channel>thought\n<channel|>";
  return { prompt: s, stopSequences: ["<turn|>", "<eos>", "<|tool_response>"] };
};


/**
 * FAMILIES — single registry. UI dropdown, JS renderer, Python mirror
 * doğrulaması bu listeden türetilir. id ↔ Python `_CHAT_TEMPLATES` anahtarı
 * birebir eşleşmek ZORUNDA.
 *
 * `pyMirror: false` → Python tarafı bu aileyi tanımıyor; agent çağrısı
 * RuntimeError verir. UI dropdown'da rozet ile gösterilir.
 */
export const FAMILIES = [
  { id: "qwen2.5",   label: "Qwen2.5 / ChatML (<|im_start|>)",   description: "Qwen2, Qwen2.5, Qwen3 + generic ChatML.",        render: _renderQwen,      pyMirror: true },
  { id: "chatml",    label: "ChatML (alias of qwen2.5)",          description: "Alias for any ChatML-format model.",              render: _renderQwen,      pyMirror: true },
  { id: "llama3",    label: "Llama 3 / 3.1 / 3.2 / 3.3",          description: "Meta Llama 3 family + DeepSeek-R1-Distill-Llama.", render: _renderLlama3,    pyMirror: true },
  { id: "mistral",   label: "Mistral v3 ([INST]...[/INST])",      description: "Mistral 7B v0.3, Mixtral, Codestral.",            render: _renderMistral,   pyMirror: true },
  { id: "gemma",     label: "Gemma 2 / 3 (<start_of_turn>)",      description: "Google Gemma 2/3; no system role.",               render: _renderGemma,     pyMirror: true },
  { id: "gemma4",    label: "Gemma 4 (native <|turn> / <|channel>)", description: "Google Gemma 4 — native protocol with thinking channel. enable_thinking via chat_template_kwargs.", render: _renderGemma4, pyMirror: true },
  { id: "deepseek",  label: "DeepSeek V2 / V3 native",            description: "DeepSeek-V2/V3 (<\uff5cbegin\u2581of\u2581sentence\uff5c>). For DeepSeek-R1-Distill-Qwen use qwen2.5 instead.", render: _renderDeepSeek, pyMirror: true },
  { id: "phi",       label: "Microsoft Phi-3 / 3.5 / 4",          description: "<|system|>, <|user|>, <|assistant|>, <|end|>.",   render: _renderPhi,       pyMirror: true },
  { id: "command-r", label: "Cohere Command-R / R+",              description: "<|START_OF_TURN_TOKEN|><|USER_TOKEN|>... .",      render: _renderCommandR,  pyMirror: true },
  { id: "yi",        label: "01.AI Yi-1.5 / Yi-Coder",            description: "ChatML-like with Yi-specific </s> stop.",         render: _renderYi,        pyMirror: true },
  { id: "raw",       label: "raw ([role] sections, experimental)", description: "Plain [role] separator. Use only for debugging.", render: _renderRaw,      pyMirror: true },
];

const _BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));

/**
 * Whitelist for /api/models POST validation. Includes "" sentinel (auto/env fallback).
 */
export const ALLOWED_FAMILY_IDS = new Set(["", ...FAMILIES.map((f) => f.id)]);

/**
 * Get family record by id (case-insensitive). Returns null for unknown id.
 */
export function getFamily(id) {
  if (!id) return null;
  return _BY_ID.get(String(id).toLowerCase()) || null;
}

/**
 * Render a chat prompt with a specific family. FAIL-LOUD: unknown family throws.
 * Empty family id falls back to env `LLM_CHAT_TEMPLATE` then `qwen2.5`.
 *
 * @param {string} familyId
 * @param {Array<{role:string, content:string}>} messages
 * @returns {{ prompt: string, stopSequences: string[], familyId: string }}
 */
export function renderFamily(familyId, messages, kwargs) {
  const requested = String(familyId || "").trim().toLowerCase();
  const effective = requested || String(process.env.LLM_CHAT_TEMPLATE || "qwen2.5").toLowerCase();
  const fam = _BY_ID.get(effective);
  if (!fam) {
    throw new Error(`chat template family '${effective}' is not registered. Known: ${[..._BY_ID.keys()].join(", ")}`);
  }
  const msgs = _collapseMessages(messages);
  const ctx = (kwargs && typeof kwargs === "object" && !Array.isArray(kwargs)) ? { kwargs } : undefined;
  const r = fam.render(msgs, ctx);
  return { prompt: r.prompt, stopSequences: r.stopSequences, familyId: fam.id };
}


/**
 * Public-facing dropdown payload for `GET /api/system/chat-templates`.
 * `pythonSupported` mirrors Python availability so the UI can flag drift.
 */
export function listFamiliesForUi() {
  return FAMILIES.map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    pythonSupported: f.pyMirror,
  }));
}
