import type { CSSProperties } from "react";

export interface WfBgTheme { id: string; label: string }
export const WF_BG_THEMES: WfBgTheme[] = [
  { id: "dots-cyan", label: "Cyan Dots" },
  { id: "dots-violet", label: "Violet Dots" },
  { id: "grid-mono", label: "Mono Grid" },
  { id: "grid-emerald", label: "Emerald Grid" },
  { id: "blueprint", label: "Blueprint" },
  { id: "midnight", label: "Midnight Glow" },
  { id: "sunset", label: "Sunset Gradient" },
  { id: "carbon", label: "Carbon Fiber" },
  { id: "paper", label: "Paper Light" },
  { id: "matrix", label: "Matrix Green" },
];

export function wfBgStyle(theme: string, solid: string): CSSProperties {
  const dots = (color: string, bg: string): CSSProperties => ({
    background: bg,
    backgroundImage: `radial-gradient(${color} 1px, transparent 1px)`,
    backgroundSize: "24px 24px",
  });
  const grid = (color: string, bg: string): CSSProperties => ({
    background: bg,
    backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
    backgroundSize: "32px 32px",
  });
  switch (theme) {
    case "dots-cyan": return dots("color-mix(in oklab, #06b6d4 35%, transparent)", "#0b1220");
    case "dots-violet": return dots("color-mix(in oklab, #8b5cf6 35%, transparent)", "#120a22");
    case "grid-mono": return grid("rgba(255,255,255,0.07)", "#0a0a0a");
    case "grid-emerald": return grid("rgba(16,185,129,0.18)", "#04140d");
    case "blueprint": return grid("rgba(125,180,255,0.22)", "#0a2a4a");
    case "midnight": return { background: "radial-gradient(circle at 30% 20%, #1e1b4b 0%, #050816 70%)" };
    case "sunset": return { background: "linear-gradient(135deg, #2a0a2e 0%, #4a1232 40%, #7a3a18 100%)" };
    case "carbon": return { background: "#111", backgroundImage: "repeating-linear-gradient(45deg, #1a1a1a 0 4px, #0d0d0d 4px 8px)" };
    case "paper": return { background: "#f5f1e8", backgroundImage: "radial-gradient(rgba(0,0,0,0.08) 1px, transparent 1px)", backgroundSize: "20px 20px" };
    case "matrix": return { background: "#020a02", backgroundImage: "linear-gradient(rgba(0,255,80,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,80,0.06) 1px, transparent 1px)", backgroundSize: "20px 20px" };
    case "solid": return { background: solid };
    default: return dots("color-mix(in oklab, var(--primary) 18%, transparent)", "var(--card)");
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportCanvasPdf(el: HTMLElement, name: string) {
  // html-to-image supports modern CSS color functions (oklch, color-mix) that
  // html2canvas chokes on — Vite/Tailwind v4 themes use oklch everywhere.
  const [{ toPng }, { default: jsPDF }] = await Promise.all([
    import("html-to-image"),
    import("jspdf"),
  ]);
  const dataUrl = await toPng(el, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0a",
  });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("snapshot decode failed"));
    img.src = dataUrl;
  });
  const w = img.naturalWidth, h = img.naturalHeight;
  const pdf = new jsPDF({ orientation: w > h ? "l" : "p", unit: "px", format: [w, h] });
  pdf.addImage(dataUrl, "PNG", 0, 0, w, h);
  pdf.save(`${name || "canvas"}.pdf`);
}

export function exportGraphMd(name: string, nodes: Array<{ id: string; label: string; x: number; y: number; meta?: string }>, edges: Array<{ source: string; target: string; label?: string }>) {
  const lines: string[] = [];
  lines.push(`# ${name}`); lines.push("");
  lines.push(`- Nodes: \`${nodes.length}\` · Edges: \`${edges.length}\``); lines.push("");
  lines.push("## Nodes");
  for (const n of nodes) lines.push(`- **${n.label}** \`${n.id}\` · pos=(${Math.round(n.x)}, ${Math.round(n.y)})${n.meta ? ` · ${n.meta}` : ""}`);
  lines.push(""); lines.push("## Edges");
  for (const e of edges) {
    const s = nodes.find(n => n.id === e.source)?.label ?? e.source;
    const t = nodes.find(n => n.id === e.target)?.label ?? e.target;
    lines.push(`- \`${s}\` → \`${t}\`${e.label ? ` _(${e.label})_` : ""}`);
  }
  lines.push(""); lines.push("```mermaid"); lines.push("graph LR");
  for (const n of nodes) lines.push(`  ${n.id.replace(/[^a-zA-Z0-9_]/g, "_")}["${n.label.replace(/"/g, "'")}"]`);
  for (const e of edges) lines.push(`  ${e.source.replace(/[^a-zA-Z0-9_]/g, "_")} --> ${e.target.replace(/[^a-zA-Z0-9_]/g, "_")}`);
  lines.push("```");
  downloadBlob(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }), `${name || "canvas"}.md`);
}

export function exportGraphVisio(name: string, nodes: Array<{ id: string; label: string; x: number; y: number; w: number; h: number }>, edges: Array<{ id: string; source: string; target: string }>, canvasH: number) {
  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const idMap = new Map<string, number>();
  nodes.forEach((n, i) => idMap.set(n.id, i + 1));
  const shapeXml = nodes.map((n) => {
    const sid = idMap.get(n.id)!;
    const cx = (n.x + n.w / 2) / 72;
    const cy = (canvasH - n.y - n.h / 2) / 72;
    const w = n.w / 72; const h = n.h / 72;
    return `      <Shape ID='${sid}' Type='Shape'>
        <XForm><PinX>${cx.toFixed(3)}</PinX><PinY>${cy.toFixed(3)}</PinY><Width>${w.toFixed(3)}</Width><Height>${h.toFixed(3)}</Height></XForm>
        <Text>${esc(n.label)}</Text>
      </Shape>`;
  }).join("\n");
  const connXml = edges.map((e, i) => {
    const sid = idMap.get(e.source); const tid = idMap.get(e.target);
    if (!sid || !tid) return "";
    const id = nodes.length + i + 1;
    return `      <Shape ID='${id}' Type='Shape'>
        <Text>${esc(e.id)}</Text>
        <Connect FromSheet='${id}' FromCell='BeginX' ToSheet='${sid}' ToCell='PinX' />
        <Connect FromSheet='${id}' FromCell='EndX' ToSheet='${tid}' ToCell='PinX' />
      </Shape>`;
  }).join("\n");
  const xml = `<?xml version='1.0' encoding='UTF-8'?>
<VisioDocument xmlns='http://schemas.microsoft.com/visio/2003/core'>
  <Pages>
    <Page ID='1' Name='${esc(name || "Canvas")}'>
      <PageSheet><PageProps><PageWidth>11</PageWidth><PageHeight>8.5</PageHeight></PageProps></PageSheet>
      <Shapes>
${shapeXml}
${connXml}
      </Shapes>
    </Page>
  </Pages>
</VisioDocument>`;
  downloadBlob(new Blob([xml], { type: "application/vnd.visio" }), `${name || "canvas"}.vdx`);
}
