const fs = require('fs');

function extractForgeJson(text) {
  if (!text) return null;
  const cleaned = String(text); // replace yapmadan
  const candidates = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < cleaned.length; j++) {
      const ch = cleaned[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") { inStr = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { candidates.push(cleaned.slice(i, j + 1)); i = j; break; }
      }
    }
  }
  candidates.sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === "object" && obj.plan) return obj;
    } catch {}
  }
  return null;
}

const txt = "Sure!\n\n  test\n  ";
console.log(JSON.stringify(extractForgeJson(txt), null, 2));
