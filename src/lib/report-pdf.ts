/**
 * High-fidelity Vector PDF renderer for the Reporting module.
 *
 * Produces a real, paginated A4 document with 100% full UTF-8 (Turkish & international)
 * support via DejaVuSans, branded header band, KPI grid, zebra-striped tables,
 * metric bars, note blocks, and numbered footers.
 */

import { ensureUnicodeFont } from "./pdf-fonts";

export type ReportKpi = { label: string; value: string; hint?: string };

export type ReportTable = {
  kind: "table";
  title: string;
  columns: string[];
  /** column width weights, defaults to equal */
  widths?: number[];
  rows: (string | number)[][];
};

export type ReportBars = {
  kind: "bars";
  title: string;
  rows: { label: string; value: number; caption?: string }[];
};

export type ReportNotes = {
  kind: "notes";
  title: string;
  items: string[];
};

export type ReportSection = ReportTable | ReportBars | ReportNotes;

export type ReportDoc = {
  title: string;
  subtitle: string;
  period: string;
  kpis: ReportKpi[];
  sections: ReportSection[];
  filename: string;
};

const INK = [15, 23, 42] as const;
const SOFT = [100, 116, 139] as const;
const LINE = [226, 232, 240] as const;
const SAPPHIRE = [21, 84, 190] as const;
const PANEL = [248, 250, 252] as const;

export async function exportReportPdf(doc: ReportDoc) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const fontFamily = await ensureUnicodeFont(pdf);

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 44;
  const width = pageW - margin * 2;
  let y = 0;
  let page = 0;

  const header = () => {
    page += 1;
    pdf.setFillColor(11, 14, 22);
    pdf.rect(0, 0, pageW, 78, "F");
    pdf.setFillColor(...SAPPHIRE);
    pdf.rect(0, 76, pageW, 2.5, "F");

    pdf.setFont(fontFamily, "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(147, 197, 253);
    pdf.text(`ELARA SOVEREIGN STUDIO  ·  ${(doc.period || "EXECUTIVE ROLLUP").toUpperCase()}`, margin, 26);

    pdf.setFont(fontFamily, "bold");
    pdf.setFontSize(15);
    pdf.setTextColor(255, 255, 255);
    const titleLines = pdf.splitTextToSize(doc.title || "Executive Report", width);
    pdf.text(titleLines[0] || "", margin, 46);

    pdf.setFont(fontFamily, "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(148, 163, 184);
    pdf.text(doc.subtitle || "Sovereign Infrastructure & Operations Ledger", margin, 62);
    y = 100;
  };

  const footer = () => {
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.5);
    pdf.line(margin, pageH - 36, pageW - margin, pageH - 36);
    pdf.setFont(fontFamily, "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...SOFT);
    pdf.text(`GENERATED: ${new Date().toLocaleString("tr-TR")} · CONFIDENTIAL`, margin, pageH - 22);
    pdf.text(`PAGE ${page}`, pageW - margin, pageH - 22, { align: "right" });
  };

  const need = (h: number) => {
    if (y + h > pageH - 52) {
      footer();
      pdf.addPage();
      header();
    }
  };

  const sectionTitle = (label: string) => {
    need(38);
    pdf.setFont(fontFamily, "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(...SAPPHIRE);
    pdf.text(label.toUpperCase(), margin, y + 8);
    y += 14;
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y, pageW - margin, y);
    y += 14;
  };

  header();

  // ---- KPI grid -----------------------------------------------------------
  if (doc.kpis && doc.kpis.length > 0) {
    const cols = Math.min(4, doc.kpis.length);
    const gap = 10;
    const cw = (width - gap * (cols - 1)) / cols;
    const ch = 56;
    for (let i = 0; i < doc.kpis.length; i += cols) {
      const row = doc.kpis.slice(i, i + cols);
      need(ch + 10);
      row.forEach((k, idx) => {
        const x = margin + idx * (cw + gap);
        pdf.setFillColor(...PANEL);
        pdf.setDrawColor(...LINE);
        pdf.roundedRect(x, y, cw, ch, 4, 4, "FD");
        pdf.setFont(fontFamily, "bold");
        pdf.setFontSize(7.5);
        pdf.setTextColor(...SOFT);
        pdf.text(k.label.toUpperCase(), x + 10, y + 16);
        pdf.setFont(fontFamily, "bold");
        pdf.setFontSize(13.5);
        pdf.setTextColor(...INK);
        pdf.text(String(k.value || ""), x + 10, y + 34);
        if (k.hint) {
          pdf.setFont(fontFamily, "normal");
          pdf.setFontSize(7.5);
          pdf.setTextColor(...SOFT);
          const splitHint = pdf.splitTextToSize(k.hint, cw - 20) as string[];
          pdf.text(splitHint[0] || "", x + 10, y + 47);
        }
      });
      y += ch + 10;
    }
    y += 8;
  }

  // ---- Sections -----------------------------------------------------------
  for (const s of doc.sections || []) {
    sectionTitle(s.title);

    if (s.kind === "table") {
      const weights = s.widths ?? s.columns.map(() => 1);
      const total = weights.reduce((a, b) => a + b, 0);
      const cols = weights.map((w) => (w / total) * width);
      const xs = cols.map((_, i) => margin + cols.slice(0, i).reduce((a, b) => a + b, 0));

      const headRow = () => {
        need(22);
        pdf.setFillColor(241, 245, 249);
        pdf.rect(margin, y - 10, width, 20, "F");
        pdf.setDrawColor(...LINE);
        pdf.setLineWidth(0.4);
        pdf.rect(margin, y - 10, width, 20, "S");
        pdf.setFont(fontFamily, "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(...SOFT);
        s.columns.forEach((c, i) => pdf.text(c.toUpperCase(), xs[i]! + 6, y + 3));
        y += 16;
      };
      headRow();

      s.rows.forEach((r, ri) => {
        const cells = r.map((c, i) => pdf.splitTextToSize(String(c ?? ""), cols[i]! - 12) as string[]);
        const linesCount = Math.max(1, ...cells.map((c) => c.length));
        const h = linesCount * 11 + 8;
        if (y + h > pageH - 52) {
          footer();
          pdf.addPage();
          header();
          sectionTitle(s.title);
          headRow();
        }
        if (ri % 2 === 1) {
          pdf.setFillColor(...PANEL);
          pdf.rect(margin, y - 8, width, h, "F");
        }
        pdf.setFont(fontFamily, "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(...INK);
        cells.forEach((lines2, i) => {
          lines2.forEach((line, li) => pdf.text(line, xs[i]! + 6, y + li * 11));
        });
        y += h;
        pdf.setDrawColor(...LINE);
        pdf.setLineWidth(0.3);
        pdf.line(margin, y - 6, pageW - margin, y - 6);
      });
      y += 16;
    }

    if (s.kind === "bars") {
      const max = Math.max(1, ...s.rows.map((r) => r.value));
      for (const r of s.rows) {
        need(26);
        pdf.setFont(fontFamily, "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(...INK);
        pdf.text(r.label, margin, y);
        pdf.setFont(fontFamily, "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(...SOFT);
        pdf.text(r.caption ?? String(r.value), pageW - margin, y, { align: "right" });
        y += 6;
        pdf.setFillColor(234, 237, 243);
        pdf.roundedRect(margin, y, width, 6, 3, 3, "F");
        pdf.setFillColor(...SAPPHIRE);
        const w = Math.max(4, (r.value / max) * width);
        pdf.roundedRect(margin, y, w, 6, 3, 3, "F");
        y += 18;
      }
      y += 8;
    }

    if (s.kind === "notes") {
      for (const item of s.items) {
        const lines = pdf.splitTextToSize(item, width - 18) as string[];
        need(lines.length * 12 + 8);
        pdf.setFillColor(...SAPPHIRE);
        pdf.circle(margin + 3, y - 3, 2, "F");
        pdf.setFont(fontFamily, "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(...INK);
        lines.forEach((l, i) => pdf.text(l, margin + 14, y + i * 12));
        y += lines.length * 12 + 6;
      }
      y += 8;
    }
  }

  footer();
  pdf.save((doc.filename || "report.pdf").replace(/\.pdf$/i, "") + ".pdf");
}
