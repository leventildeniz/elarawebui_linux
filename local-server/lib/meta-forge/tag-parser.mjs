// lib/meta-forge/tag-parser.mjs
// Streaming sniffer that detects a <forge kind="..." name="...">intent</forge>
// tag anywhere within the first `windowChars` of a model's streamed output.
//
// Contract:
//   const sniff = createForgeTagSniffer({
//     windowChars: 1200,           // stop scanning after N raw chars
//     onDeclared: ({kind,name,intent,raw}) => {...},
//   });
//   const visible = sniff.feed(deltaChunk); // returns delta with tag stripped
//   sniff.flush();                          // call after stream end
//   sniff.state.declared                    // boolean
//   sniff.state.payload                     // {kind,name,intent,raw}|null
//
// Design notes:
// - Streaming-safe: partial tag across chunk boundaries is buffered.
// - Case-insensitive tag name; attributes may be double- or single-quoted.
// - Only the FIRST tag is recognized; extra tags stream through untouched.
// - After windowChars is exceeded without any '<' seen, sniffing switches to
//   passthrough for zero overhead on long RAG answers.
//
// The parser is intentionally regex-lite: a small state machine walks the
// buffer once per chunk and returns the visible slice. No heavy regex is run
// on the hot streaming path.

const OPEN_TAG_RE = /<\s*forge\b([^>]*)>/i;
const CLOSE_TAG_RE = /<\s*\/\s*forge\s*>/i;
const ATTR_RE = /(kind|name|intent)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

function parseAttrs(attrString) {
  const out = { kind: null, name: null, intent: null };
  if (!attrString) return out;
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrString)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[3] ?? m[4] ?? m[5] ?? "";
    if (key === "kind" || key === "name" || key === "intent") {
      out[key] = String(val || "").trim();
    }
  }
  return out;
}

function normalizeKind(k) {
  const v = String(k || "").toLowerCase().trim();
  if (v === "skill" || v === "tool" || v === "agent" || v === "pack" || v === "capability_pack") {
    return v === "capability_pack" ? "pack" : v;
  }
  return null;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function createForgeTagSniffer(opts = {}) {
  const windowChars = Math.max(200, Number(opts.windowChars ?? 1200));
  const onDeclared = typeof opts.onDeclared === "function" ? opts.onDeclared : null;

  const state = {
    seenChars: 0,
    buffered: "",         // pending characters (may contain partial tag)
    declared: false,
    payload: null,
    disabled: false,      // true once we're past the window and no tag pending
  };

  function tryEmitDeclaration(inner, attrString) {
    const attrs = parseAttrs(attrString);
    const kind = normalizeKind(attrs.kind);
    const rawIntent = attrs.intent && attrs.intent.trim().length > 0
      ? attrs.intent.trim()
      : String(inner || "").trim();
    const name = attrs.name ? slugify(attrs.name) : slugify(rawIntent.split(/\s+/).slice(0, 6).join(" "));
    if (!kind || !rawIntent || rawIntent.length < 3) return false;
    state.declared = true;
    state.payload = { kind, name: name || "unnamed", intent: rawIntent.slice(0, 500), raw: rawIntent };
    if (onDeclared) {
      try { onDeclared(state.payload); } catch { /* consumer error is not fatal */ }
    }
    return true;
  }

  function feed(chunk) {
    if (state.disabled || !chunk) return chunk || "";
    // Fast path: once declared, stream everything through (no re-scan).
    if (state.declared) return chunk;

    state.seenChars += chunk.length;
    state.buffered += chunk;

    // If the buffer never opened a tag by the window boundary, give up cheaply.
    const idxOpen = state.buffered.search(/<\s*forge\b/i);
    if (idxOpen === -1) {
      if (state.seenChars > windowChars) {
        // Emit everything, disable further scanning.
        const out = state.buffered;
        state.buffered = "";
        state.disabled = true;
        return out;
      }
      // Might be a partial "<", "<f", "<fo"... keep last few chars buffered
      // to detect a tag straddling the boundary.
      const tail = state.buffered.slice(-8);
      const hasPartial = /<[\s\w]*$/.test(tail);
      if (!hasPartial) {
        const out = state.buffered;
        state.buffered = "";
        return out;
      }
      // Emit everything except the last (potential-partial) 8 chars.
      const safeLen = Math.max(0, state.buffered.length - 8);
      const out = state.buffered.slice(0, safeLen);
      state.buffered = state.buffered.slice(safeLen);
      return out;
    }

    // We have an open-tag position. Emit everything before it as-is,
    // then try to complete the tag.
    const before = state.buffered.slice(0, idxOpen);
    const rest = state.buffered.slice(idxOpen);
    const openMatch = rest.match(OPEN_TAG_RE);
    if (!openMatch) {
      // We saw <forge... but no '>' yet — buffer & wait.
      state.buffered = rest;
      return before;
    }
    const openLen = openMatch[0].length;
    const attrString = openMatch[1] || "";
    const afterOpen = rest.slice(openLen);
    // Try to find the closing tag OR treat as self-contained via intent attr.
    const closeIdx = afterOpen.search(CLOSE_TAG_RE);
    if (closeIdx === -1) {
      // If intent attribute is present, we can emit right away and strip open tag.
      const attrs = parseAttrs(attrString);
      if (attrs.intent && attrs.kind) {
        const emitted = tryEmitDeclaration("", attrString);
        if (emitted) {
          // Consume just the open tag; leave downstream chars in buffer to keep streaming.
          state.buffered = afterOpen;
          return before;
        }
      }
      // Wait for close tag; buffer the whole rest.
      state.buffered = rest;
      return before;
    }
    // Have full <forge...>inner</forge>
    const inner = afterOpen.slice(0, closeIdx);
    const closeMatch = afterOpen.slice(closeIdx).match(CLOSE_TAG_RE);
    const closeLen = closeMatch ? closeMatch[0].length : "</forge>".length;
    const after = afterOpen.slice(closeIdx + closeLen);
    tryEmitDeclaration(inner, attrString);
    // Anything AFTER the tag streams normally.
    state.buffered = "";
    state.disabled = true;
    return before + after;
  }

  function flush() {
    if (state.disabled || !state.buffered) {
      const out = state.buffered;
      state.buffered = "";
      return out;
    }
    // Never got the closer — but if we already have an open tag with intent attr,
    // we've already declared. Otherwise flush buffer as-is (user sees what model wrote).
    const out = state.buffered;
    state.buffered = "";
    state.disabled = true;
    return out;
  }

  return { feed, flush, state };
}
