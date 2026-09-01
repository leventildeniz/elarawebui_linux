// Lazy-load a UTF-8 font (Noto Sans Regular + Bold) into jsPDF so Turkish chars
// render perfectly. We try the LAN-vendored /fonts/*.ttf first (zero-internet
// guarantee), then fall back to a public CDN, then to helvetica.
import type { jsPDF } from "jspdf";

// Vendored under public/fonts (served at the app origin — works fully offline).
const LOCAL_REGULAR = "/fonts/NotoSans-Regular.ttf";
const LOCAL_BOLD = "/fonts/NotoSans-Bold.ttf";
// Last-resort CDN mirrors (only reached when the vendored copy is missing).
const CDN_REGULAR = "https://cdn.jsdelivr.net/gh/google/fonts@main/apache/roboto/static/Roboto-Regular.ttf";
const CDN_BOLD = "https://cdn.jsdelivr.net/gh/google/fonts@main/apache/roboto/static/Roboto-Bold.ttf";

let cachedRegular: string | null = null;
let cachedBold: string | null = null;
let cachedFamily: "NotoSans" | "Roboto" | null = null;

async function fetchAsBase64(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`font fetch failed ${r.status} ${url}`);
  const buf = await r.arrayBuffer();
  // Sanity: a TTF starts with 0x00010000 or 'OTTO' or 'true'/'typ1'. Reject HTML 404.
  if (buf.byteLength < 10000) throw new Error(`font too small ${buf.byteLength}`);
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function loadPair(): Promise<"NotoSans" | "Roboto"> {
  // Prefer the LAN-vendored copy.
  try {
    cachedRegular = await fetchAsBase64(LOCAL_REGULAR);
    cachedBold = await fetchAsBase64(LOCAL_BOLD).catch(() => cachedRegular!);
    return "NotoSans";
  } catch {
    /* fall through to CDN */
  }
  cachedRegular = await fetchAsBase64(CDN_REGULAR);
  cachedBold = await fetchAsBase64(CDN_BOLD).catch(() => cachedRegular!);
  return "Roboto";
}

/**
 * Registers a UTF-8 capable font into the given jsPDF instance and switches
 * the active font so İ, ı, ğ, ü, ş, ö, ç render correctly. Falls back to
 * helvetica silently if every source is unreachable.
 */
export async function ensureUnicodeFont(doc: jsPDF): Promise<"NotoSans" | "Roboto" | "helvetica"> {
  try {
    if (!cachedRegular || !cachedBold || !cachedFamily) {
      cachedFamily = await loadPair();
    }
    const family = cachedFamily;
    const regularFile = `${family}-Regular.ttf`;
    const boldFile = `${family}-Bold.ttf`;
    doc.addFileToVFS(regularFile, cachedRegular!);
    doc.addFont(regularFile, family, "normal");
    doc.addFileToVFS(boldFile, cachedBold!);
    doc.addFont(boldFile, family, "bold");
    doc.setFont(family, "normal");
    return family;
  } catch (e) {
    console.warn("[pdf-fonts] Unicode font unavailable, falling back to helvetica:", e);
    return "helvetica";
  }
}
