// local-server/lib/meta-forge/stream-parser.mjs
// Tur 7 — streaming plan card.
// forge_master.py stdout'unu chunk-chunk parçalar, `"create":[ {...}, {...} ]`
// dizisinde her tamamlanmış balanced-brace nesnesini `onCreateItem`'a teslim
// eder. `"intent":"..."` string'i ilk kez göründüğünde `onIntent`'e gider.
// Kural: sadece parse edilebilir olan yayılır; yarım nesne buffer'da bekler.
//
// Buffer 4MB'ta sıkışırsa baş taraf düşürülür (planner tipik çıktısı 8-12KB;
// pathological durumda safety-net).

export function createStreamingForgeParser({ onIntent, onCreateItem } = {}) {
  let buf = "";
  let intentEmitted = false;
  let createArrayStart = -1; // buf içinde '[' SONRASI ilk karakter
  let scanCursor = 0;        // create[] içindeki tarama konumu

  function tryIntent() {
    if (intentEmitted) return;
    const m = /"intent"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(buf);
    if (!m) return;
    intentEmitted = true;
    try { onIntent && onIntent(m[1]); } catch { /* */ }
  }

  function findCreateArray() {
    if (createArrayStart >= 0) return;
    const m = /"create"\s*:\s*\[/.exec(buf);
    if (!m) return;
    createArrayStart = m.index + m[0].length;
    scanCursor = createArrayStart;
  }

  function scanItems() {
    if (createArrayStart < 0) return;
    let i = scanCursor;
    while (i < buf.length) {
      while (i < buf.length && (buf[i] === " " || buf[i] === "\n" || buf[i] === "\r" || buf[i] === "\t" || buf[i] === ",")) i++;
      if (i >= buf.length) break;
      if (buf[i] === "]") { scanCursor = i; return; }
      if (buf[i] !== "{") { i++; continue; }
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let j = i; j < buf.length; j++) {
        const ch = buf[j];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) { end = j; break; }
        }
      }
      if (end < 0) { scanCursor = i; return; } // daha fazla veri bekle
      const slice = buf.slice(i, end + 1);
      try {
        const obj = JSON.parse(slice);
        if (obj && typeof obj === "object") {
          try { onCreateItem && onCreateItem(obj); } catch { /* */ }
        }
      } catch { /* malformed, atla */ }
      i = end + 1;
      scanCursor = i;
    }
    scanCursor = i;
  }

  return {
    feed(chunk) {
      if (!chunk) return;
      buf += String(chunk);
      if (buf.length > 4 * 1024 * 1024) {
        const drop = buf.length - 2 * 1024 * 1024;
        buf = buf.slice(drop);
        if (createArrayStart >= 0) createArrayStart = Math.max(0, createArrayStart - drop);
        scanCursor = Math.max(0, scanCursor - drop);
      }
      tryIntent();
      findCreateArray();
      scanItems();
    },
    getBuffer() { return buf; },
  };
}
