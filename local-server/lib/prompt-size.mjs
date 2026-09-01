// prompt-size.mjs — MLX'e giden mesaj dizisinin diagnostik özeti.
//
// SAFE: hiçbir şey kesmez/değiştirmez, sadece sayıları döker.
// chatTrace breadcrumb'una geçirmek için tasarlandı (mlx.prompt.size).
//
// Section dedektörleri içerik fingerprint'i (TR/EN). Bulamazsa "other"a
// düşer; toplam karakter+token gene doğru çıkar. Token ≈ chars/4 (rough).

const SECTION_PATTERNS = [
  { key: "identity",     re: /(K[İI]ML[İI]K:|^Sen ELARA|You are ELARA|kimliği:)/im },
  { key: "tools",        re: /(Tool arsenal|TOOL[S]? AVAILABLE|@tools|##\s*Tools|Available tools:)/im },
  { key: "skills",       re: /(Skills armory|SKILL[S]? AVAILABLE|!slug|##\s*Skills)/im },
  { key: "rag_inject",   re: /(EVIDENCE|<\/?context>|CITED SOURCES|kaynaklar:)/im },
  { key: "smalltalk_rules", re: /(smalltalk|kısa cevap|no_think|tetikleme)/im },
];

export function summarizePromptMessages(messages) {
  const arr = Array.isArray(messages) ? messages : [];
  let totalChars = 0;
  const byRole = { system: 0, user: 0, assistant: 0, tool: 0, other: 0 };
  const sections = {};
  const messagesOut = [];

  for (const m of arr) {
    const role = String(m?.role || "other");
    const content = typeof m?.content === "string"
      ? m.content
      : (Array.isArray(m?.content) ? m.content.map((p) => p?.text || "").join("") : String(m?.content || ""));
    const len = content.length;
    totalChars += len;
    if (byRole[role] != null) byRole[role] += len; else byRole.other += len;
    messagesOut.push({ role, chars: len });

    // system mesajının içinde bölüm fingerprint'i ara
    if (role === "system" && len > 0) {
      for (const { key, re } of SECTION_PATTERNS) {
        if (re.test(content)) {
          sections[key] = (sections[key] || 0) + len;
          break; // ilk eşleşen kategoriye düşsün, double-count yok
        }
      }
    }
  }

  // system içinde hiç fingerprint çıkmadıysa "system_other" altında topla
  const matchedSystemChars = Object.values(sections).reduce((a, b) => a + b, 0);
  const systemOther = Math.max(0, byRole.system - matchedSystemChars);
  if (systemOther > 0) sections.system_other = systemOther;

  return {
    count: arr.length,
    totalChars,
    approxTokens: Math.round(totalChars / 4),
    byRole,
    sections,        // { identity, tools, skills, rag_inject, smalltalk_rules, system_other }
    messages: messagesOut, // [{role, chars}, ...] sırayla
  };
}
