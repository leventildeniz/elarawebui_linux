// Vector PDF helpers for the Reporting & Analytics page.
// Pure jsPDF drawing — no DOM raster, no html-to-image. Fast + sharp at any zoom.
//
// IMPORTANT: this module is used ONLY by `src/routes/_app.reports.tsx`.
// Chat PDF export (`_app.chat.tsx`) and workflow canvas export (`wf-canvas.ts`)
// have their own pipelines and are intentionally untouched.

import type jsPDF from "jspdf";

export const REPORT_PALETTE = {
  primary: [124, 58, 237] as [number, number, number],   // violet-600
  cyan:    [6, 182, 212] as  [number, number, number],
  amber:   [245, 158, 11] as [number, number, number],
  red:     [239, 68, 68]  as [number, number, number],
  green:   [16, 185, 129] as [number, number, number],
  ink:     [20, 16, 38]   as  [number, number, number],
  muted:   [120, 120, 140] as [number, number, number],
  grid:    [225, 225, 235] as [number, number, number],
  card:    [248, 248, 252] as [number, number, number],
};
export const SERIES_COLORS = [
  REPORT_PALETTE.primary, REPORT_PALETTE.cyan, REPORT_PALETTE.amber,
  REPORT_PALETTE.red, REPORT_PALETTE.green,
];

export function drawHeader(
  pdf: jsPDF,
  opts: { brand: string; scope: string; from: string; to: string },
) {
  const W = pdf.internal.pageSize.getWidth();
  pdf.setFillColor(...REPORT_PALETTE.ink);
  pdf.rect(0, 0, W, 80, "F");
  pdf.setFillColor(...REPORT_PALETTE.primary);
  pdf.rect(0, 78, W, 2, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(20);
  pdf.text(opts.brand || "AI OS", 40, 40);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10);
  pdf.text(`${opts.scope} report · ${opts.from} → ${opts.to}`, 40, 58);
  pdf.text(`Generated: ${new Date().toLocaleString()}`, 40, 72);
  pdf.setTextColor(0, 0, 0);
}

export function drawFooter(pdf: jsPDF, brand: string) {
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    pdf.setDrawColor(...REPORT_PALETTE.grid);
    pdf.setLineWidth(0.5);
    pdf.line(40, H - 30, W - 40, H - 30);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
    pdf.setTextColor(...REPORT_PALETTE.muted);
    pdf.text(brand || "AI OS", 40, H - 18);
    pdf.text(`Page ${p} of ${total}`, W - 40, H - 18, { align: "right" });
    pdf.setTextColor(0, 0, 0);
  }
}

export function drawKpiCards(
  pdf: jsPDF,
  startY: number,
  kpis: Array<{ label: string; value: string }>,
) {
  const W = pdf.internal.pageSize.getWidth();
  const margin = 40;
  const gap = 12;
  const cols = Math.min(4, kpis.length);
  const cardW = (W - margin * 2 - gap * (cols - 1)) / cols;
  const cardH = 64;
  kpis.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cardW + gap);
    const y = startY + row * (cardH + gap);
    pdf.setFillColor(...REPORT_PALETTE.card);
    pdf.setDrawColor(...REPORT_PALETTE.grid);
    pdf.setLineWidth(0.6);
    pdf.roundedRect(x, y, cardW, cardH, 6, 6, "FD");
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
    pdf.setTextColor(...REPORT_PALETTE.muted);
    pdf.text(k.label.toUpperCase(), x + 12, y + 18);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(20);
    pdf.setTextColor(...REPORT_PALETTE.primary);
    pdf.text(k.value, x + 12, y + 44);
  });
  pdf.setTextColor(0, 0, 0);
  const rows = Math.ceil(kpis.length / cols);
  return startY + rows * (cardH + gap);
}

interface ChartSeries { key: string; label: string; color?: [number, number, number] }

function drawChartFrame(
  pdf: jsPDF, x: number, y: number, w: number, h: number, title: string,
) {
  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(...REPORT_PALETTE.grid);
  pdf.setLineWidth(0.6);
  pdf.roundedRect(x, y, w, h, 6, 6, "FD");
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(10);
  pdf.setTextColor(...REPORT_PALETTE.ink);
  pdf.text(title, x + 14, y + 18);
}

function drawAxes(
  pdf: jsPDF, plot: { x: number; y: number; w: number; h: number },
  yMax: number, xLabels: string[],
) {
  const { x, y, w, h } = plot;
  pdf.setDrawColor(...REPORT_PALETTE.grid);
  pdf.setLineWidth(0.4);
  for (let i = 0; i <= 4; i++) {
    const yy = y + (h * i) / 4;
    pdf.line(x, yy, x + w, yy);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
    pdf.setTextColor(...REPORT_PALETTE.muted);
    const v = Math.round(yMax - (yMax * i) / 4);
    pdf.text(String(v), x - 4, yy + 2, { align: "right" });
  }
  // X labels — sample at most 6 to avoid overlap
  const step = Math.max(1, Math.ceil(xLabels.length / 6));
  for (let i = 0; i < xLabels.length; i += step) {
    const xx = x + (w * i) / Math.max(1, xLabels.length - 1);
    pdf.setFontSize(7); pdf.setTextColor(...REPORT_PALETTE.muted);
    pdf.text(xLabels[i] ?? "", xx, y + h + 10, { align: "center" });
  }
  pdf.setTextColor(0, 0, 0);
}

function drawLegend(
  pdf: jsPDF, x: number, y: number, items: Array<{ label: string; color: [number, number, number] }>,
) {
  let cx = x;
  items.forEach((it) => {
    pdf.setFillColor(...it.color);
    pdf.rect(cx, y - 4, 8, 8, "F");
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
    pdf.setTextColor(...REPORT_PALETTE.ink);
    pdf.text(it.label, cx + 12, y + 2);
    cx += 14 + pdf.getTextWidth(it.label) + 12;
  });
  pdf.setTextColor(0, 0, 0);
}

function emptyHint(pdf: jsPDF, plot: { x: number; y: number; w: number; h: number }, msg: string) {
  pdf.setFont("helvetica", "italic"); pdf.setFontSize(10);
  pdf.setTextColor(...REPORT_PALETTE.muted);
  pdf.text(msg, plot.x + plot.w / 2, plot.y + plot.h / 2, { align: "center" });
  pdf.setTextColor(0, 0, 0);
}

export function drawLineChart(
  pdf: jsPDF, opts: {
    x: number; y: number; w: number; h: number;
    title: string;
    data: Array<Record<string, number | string>>;
    xKey: string;
    series: ChartSeries[];
  },
) {
  const { x, y, w, h, title, data, xKey, series } = opts;
  drawChartFrame(pdf, x, y, w, h, title);
  const plot = { x: x + 36, y: y + 32, w: w - 56, h: h - 60 };
  if (!data.length) { emptyHint(pdf, plot, "No samples in this range yet."); return; }
  const allValues = series.flatMap((s) => data.map((d) => Number(d[s.key]) || 0));
  const yMax = Math.max(1, Math.ceil(Math.max(...allValues, 1) * 1.1));
  const labels = data.map((d) => String(d[xKey] ?? ""));
  drawAxes(pdf, plot, yMax, labels);
  series.forEach((s, si) => {
    const color = s.color ?? SERIES_COLORS[si % SERIES_COLORS.length];
    pdf.setDrawColor(...color);
    pdf.setLineWidth(1.4);
    let prev: { x: number; y: number } | null = null;
    data.forEach((d, i) => {
      const px = plot.x + (plot.w * i) / Math.max(1, data.length - 1);
      const py = plot.y + plot.h - (plot.h * (Number(d[s.key]) || 0)) / yMax;
      if (prev) pdf.line(prev.x, prev.y, px, py);
      prev = { x: px, y: py };
    });
  });
  drawLegend(pdf, plot.x, y + h - 8,
    series.map((s, si) => ({ label: s.label, color: s.color ?? SERIES_COLORS[si % SERIES_COLORS.length] })));
}

export function drawBarChart(
  pdf: jsPDF, opts: {
    x: number; y: number; w: number; h: number;
    title: string;
    data: Array<Record<string, number | string>>;
    xKey: string;
    series: ChartSeries[];
  },
) {
  const { x, y, w, h, title, data, xKey, series } = opts;
  drawChartFrame(pdf, x, y, w, h, title);
  const plot = { x: x + 36, y: y + 32, w: w - 56, h: h - 60 };
  if (!data.length) { emptyHint(pdf, plot, "No samples in this range yet."); return; }
  const allValues = series.flatMap((s) => data.map((d) => Number(d[s.key]) || 0));
  const yMax = Math.max(1, Math.ceil(Math.max(...allValues, 1) * 1.1));
  const labels = data.map((d) => String(d[xKey] ?? ""));
  drawAxes(pdf, plot, yMax, labels);
  const groupW = plot.w / Math.max(1, data.length);
  const barW = Math.max(2, (groupW * 0.7) / series.length);
  data.forEach((d, i) => {
    const groupX = plot.x + i * groupW + (groupW - barW * series.length) / 2;
    series.forEach((s, si) => {
      const v = Number(d[s.key]) || 0;
      const bh = (plot.h * v) / yMax;
      const color = s.color ?? SERIES_COLORS[si % SERIES_COLORS.length];
      pdf.setFillColor(...color);
      pdf.rect(groupX + si * barW, plot.y + plot.h - bh, barW - 1, bh, "F");
    });
  });
  drawLegend(pdf, plot.x, y + h - 8,
    series.map((s, si) => ({ label: s.label, color: s.color ?? SERIES_COLORS[si % SERIES_COLORS.length] })));
}

export function drawPieChart(
  pdf: jsPDF, opts: {
    x: number; y: number; w: number; h: number;
    title: string;
    slices: Array<{ name: string; value: number; color?: [number, number, number] }>;
  },
) {
  const { x, y, w, h, title, slices } = opts;
  drawChartFrame(pdf, x, y, w, h, title);
  const plot = { x: x + 14, y: y + 32, w: w - 28, h: h - 48 };
  const total = slices.reduce((s, n) => s + Math.max(0, n.value), 0);
  if (!total) { emptyHint(pdf, plot, "No events recorded in this range."); return; }
  const cx = plot.x + plot.h / 2 + 10;
  const cy = plot.y + plot.h / 2;
  const r = Math.min(plot.h / 2 - 6, 70);
  let acc = -Math.PI / 2;
  // Approximate the pie with thin triangle fans (jsPDF lacks an arc primitive).
  slices.forEach((s, i) => {
    if (s.value <= 0) return;
    const sweep = (s.value / total) * Math.PI * 2;
    const steps = Math.max(8, Math.ceil((sweep / (Math.PI * 2)) * 64));
    const color = s.color ?? SERIES_COLORS[i % SERIES_COLORS.length];
    pdf.setFillColor(...color);
    for (let k = 0; k < steps; k++) {
      const a1 = acc + (sweep * k) / steps;
      const a2 = acc + (sweep * (k + 1)) / steps;
      pdf.triangle(
        cx, cy,
        cx + Math.cos(a1) * r, cy + Math.sin(a1) * r,
        cx + Math.cos(a2) * r, cy + Math.sin(a2) * r,
        "F",
      );
    }
    acc += sweep;
  });
  // Legend on the right
  const lx = cx + r + 24;
  let ly = plot.y + 14;
  slices.forEach((s, i) => {
    const color = s.color ?? SERIES_COLORS[i % SERIES_COLORS.length];
    pdf.setFillColor(...color);
    pdf.rect(lx, ly - 7, 9, 9, "F");
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
    pdf.setTextColor(...REPORT_PALETTE.ink);
    const pct = total ? Math.round((s.value / total) * 100) : 0;
    pdf.text(`${s.name} — ${s.value} (${pct}%)`, lx + 14, ly);
    ly += 16;
  });
  pdf.setTextColor(0, 0, 0);
}
