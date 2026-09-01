/** Maps a filename to a compact type badge + jewel tone used across the RAG views. */
export type FileKindInfo = { ext: string; label: string; tone: string; family: string };

const MAP: Record<string, { label: string; tone: string; family: string }> = {
  pdf: { label: "PDF", tone: "ruby", family: "document" },
  doc: { label: "DOC", tone: "sapphire", family: "document" },
  docx: { label: "DOCX", tone: "sapphire", family: "document" },
  rtf: { label: "RTF", tone: "sapphire", family: "document" },
  txt: { label: "TXT", tone: "platinum", family: "text" },
  log: { label: "LOG", tone: "platinum", family: "text" },
  md: { label: "MD", tone: "amethyst", family: "text" },
  mdx: { label: "MDX", tone: "amethyst", family: "text" },
  xls: { label: "XLS", tone: "emerald", family: "sheet" },
  xlsx: { label: "XLSX", tone: "emerald", family: "sheet" },
  csv: { label: "CSV", tone: "emerald", family: "sheet" },
  ppt: { label: "PPT", tone: "topaz", family: "slides" },
  pptx: { label: "PPTX", tone: "topaz", family: "slides" },
  json: { label: "JSON", tone: "topaz", family: "code" },
  yaml: { label: "YAML", tone: "topaz", family: "code" },
  yml: { label: "YML", tone: "topaz", family: "code" },
  xml: { label: "XML", tone: "topaz", family: "code" },
  html: { label: "HTML", tone: "topaz", family: "code" },
  mp3: { label: "MP3", tone: "amethyst", family: "audio" },
  wav: { label: "WAV", tone: "amethyst", family: "audio" },
  m4a: { label: "M4A", tone: "amethyst", family: "audio" },
  mp4: { label: "MP4", tone: "sapphire", family: "video" },
  mov: { label: "MOV", tone: "sapphire", family: "video" },
  png: { label: "PNG", tone: "emerald", family: "image" },
  jpg: { label: "JPG", tone: "emerald", family: "image" },
  jpeg: { label: "JPEG", tone: "emerald", family: "image" },
  webp: { label: "WEBP", tone: "emerald", family: "image" },
};

export function fileKind(name: string): FileKindInfo {
  const base = name.split(/[\\/]/).pop() ?? name;
  if (/^https?:/i.test(name)) return { ext: "url", label: "URL", tone: "amethyst", family: "link" };
  const raw = base.includes(".") ? (base.split(".").pop() ?? "") : "";
  const ext = /^[a-z0-9]{1,5}$/i.test(raw) ? raw.toLowerCase() : "";
  const hit = MAP[ext];
  return hit
    ? { ext, ...hit }
    : { ext, label: ext ? ext.toUpperCase() : "DOC", tone: "platinum", family: "file" };
}

/** Tags the system derives on its own — the user never types a tag. */
export function autoTagsFor(name: string, folderTags: string[], spaceName?: string) {
  // We only return the explicitly defined folder tags, no more noisy auto-generated ones.
  return []; // No more auto-generated or folder tags. Just clean slate.
}
