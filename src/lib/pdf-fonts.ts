// src/lib/pdf-fonts.ts
// Offline Unicode font loader for jsPDF.
// Loads DejaVuSans (Regular + Bold) from public/fonts to provide 100% full
// native Turkish (ç, Ç, ğ, Ğ, ı, İ, ö, Ö, ş, Ş, ü, Ü) and international UTF-8 support.

import type { jsPDF } from "jspdf";

const LOCAL_REGULAR = "/fonts/DejaVuSans-Regular.ttf";
const LOCAL_BOLD = "/fonts/DejaVuSans-Bold.ttf";

let cachedRegular: string | null = null;
let cachedBold: string | null = null;

async function fetchAsBase64(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`font fetch failed ${r.status} ${url}`);
  const buf = await r.arrayBuffer();
  if (buf.byteLength < 10000) throw new Error(`font too small ${buf.byteLength}`);
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * Registers DejaVuSans UTF-8 font into jsPDF so Turkish characters render perfectly.
 * Falls back to helvetica if fonts are unreachable.
 */
export async function ensureUnicodeFont(doc: jsPDF): Promise<"DejaVuSans" | "helvetica"> {
  try {
    if (!cachedRegular || !cachedBold) {
      cachedRegular = await fetchAsBase64(LOCAL_REGULAR);
      cachedBold = await fetchAsBase64(LOCAL_BOLD).catch(() => cachedRegular!);
    }
    const family = "DejaVuSans";
    doc.addFileToVFS("DejaVuSans-Regular.ttf", cachedRegular!);
    doc.addFont("DejaVuSans-Regular.ttf", family, "normal");
    doc.addFileToVFS("DejaVuSans-Bold.ttf", cachedBold!);
    doc.addFont("DejaVuSans-Bold.ttf", family, "bold");
    doc.setFont(family, "normal");
    return family;
  } catch (e) {
    console.warn("[pdf-fonts] Unicode font unavailable, falling back to helvetica:", e);
    doc.setFont("helvetica", "normal");
    return "helvetica";
  }
}
