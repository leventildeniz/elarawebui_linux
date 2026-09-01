/**
 * High-fidelity PDF renderer for the Reporting module.
 *
 * Produces a real, paginated A4 document (no print dialog): branded header
 * band, KPI grid, zebra-striped tables, note blocks and numbered footers.
 */

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

const INK = [24, 26, 32] as const;
const SOFT = [110, 116, 130] as const;
const LINE = [223, 226, 233] as const;
const SAPPHIRE = [21, 84, 190] as const;
const PANEL = [246, 247, 250] as const;

export async function exportReportPdf(doc: ReportDoc) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 48;
  const width = pageW - margin * 2;
  let y = 0;
  let page = 0;

  const header = () => {
    page += 1;
    pdf.setFillColor(11, 14, 22);
    pdf.rect(0, 0, pageW, 96, "F");
    pdf.setFillColor(...SAPPHIRE);
    pdf.rect(0, 94, pageW, 2, "F");

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(17);
    pdf.setTextColor(244, 246, 250);
    pdf.text(doc.title, margin, 46);

    pdf.setFont("courier", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(150, 160, 180);
    pdf.text(`ELARA SOVEREIGN STUDIO  ·  ${doc.period.toUpperCase()}`, margin, 66);
    pdf.text(doc.subtitle, margin, 80);
    y = 128;
  };

  const footer = () => {
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.5);
    pdf.line(margin, pageH - 44, pageW - margin, pageH - 44);
    pdf.setFont("courier", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...SOFT);
    pdf.text(`GENERATED ${new Date().toLocaleString()}`, margin, pageH - 28);
    pdf.text(`PAGE ${page}`, pageW - margin, pageH - 28, { align: "right" });
  };

  const need = (h: number) => {
    if (y + h > pageH - 64) {
      footer();
      pdf.addPage();
      header();
    }
  };

  const sectionTitle = (label: string) => {
    need(46);
    pdf.setFont("courier", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(...SAPPHIRE);
    pdf.text(label.toUpperCase(), margin, y);
    y += 8;
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.5);
    pdf.line(margin, y, pageW - margin, y);
    y += 18;
  };

  header();

  // ---- KPI grid -----------------------------------------------------------
  if (doc.kpis.length) {
    const cols = 4;
    const gap = 12;
    const cw = (width - gap * (cols - 1)) / cols;
    const ch = 64;
    for (let i = 0; i < doc.kpis.length; i += cols) {
      const row = doc.kpis.slice(i, i + cols);
      need(ch + 14);
      row.forEach((k, idx) => {
        const x = margin + idx * (cw + gap);
        pdf.setFillColor(...PANEL);
        pdf.setDrawColor(...LINE);
        pdf.roundedRect(x, y, cw, ch, 6, 6, "FD");
        pdf.setFont("courier", "normal");
        pdf.setFontSize(7.5);
        pdf.setTextColor(...SOFT);
        pdf.text(k.label.toUpperCase(), x + 12, y + 18);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(15);
        pdf.setTextColor(...INK);
        pdf.text(k.value, x + 12, y + 40);
        if (k.hint) {
          pdf.setFont("courier", "normal");
          pdf.setFontSize(7.5);
          pdf.setTextColor(...SOFT);
          pdf.text(pdf.splitTextToSize(k.hint, cw - 24)[0] as string, x + 12, y + 54);
        }
      });
      y += ch + 14;
    }
    y += 10;
  }

  // ---- Sections -----------------------------------------------------------
  for (const s of doc.sections) {
    sectionTitle(s.title);

    if (s.kind === "table") {
      const weights = s.widths ?? s.columns.map(() => 1);
      const total = weights.reduce((a, b) => a + b, 0);
      const cols = weights.map((w) => (w / total) * width);
      const xs = cols.map((_, i) => margin + cols.slice(0, i).reduce((a, b) => a + b, 0));

      const headRow = () => {
        need(26);
        pdf.setFillColor(238, 240, 245);
        pdf.rect(margin, y - 12, width, 22, "F");
        pdf.setFont("courier", "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(...SOFT);
        s.columns.forEach((c, i) => pdf.text(c.toUpperCase(), xs[i]! + 8, y + 3));
        y += 22;
      };
      headRow();

      s.rows.forEach((r, ri) => {
        const cells = r.map((c, i) => pdf.splitTextToSize(String(c), cols[i]! - 16) as string[]);
        const lines = Math.max(...cells.map((c) => c.length));
        const h = lines * 12 + 10;
        if (y + h > pageH - 64) {
          footer();
          pdf.addPage();
          header();
          sectionTitle(s.title);
          headRow();
        }
        if (ri % 2 === 1) {
          pdf.setFillColor(249, 250, 252);
          pdf.rect(margin, y - 10, width, h, "F");
        }
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.5);
        pdf.setTextColor(...INK);
        cells.forEach((lines2, i) => {
          lines2.forEach((line, li) => pdf.text(line, xs[i]! + 8, y + li * 12));
        });
        y += h;
        pdf.setDrawColor(...LINE);
        pdf.setLineWidth(0.4);
        pdf.line(margin, y - 8, pageW - margin, y - 8);
      });
      y += 22;
    }

    if (s.kind === "bars") {
      const max = Math.max(1, ...s.rows.map((r) => r.value));
      for (const r of s.rows) {
        need(30);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.5);
        pdf.setTextColor(...INK);
        pdf.text(r.label, margin, y);
        pdf.setFont("courier", "normal");
        pdf.setFontSize(8.5);
        pdf.setTextColor(...SOFT);
        pdf.text(r.caption ?? String(r.value), pageW - margin, y, { align: "right" });
        y += 7;
        pdf.setFillColor(234, 237, 243);
        pdf.roundedRect(margin, y, width, 7, 3, 3, "F");
        pdf.setFillColor(...SAPPHIRE);
        const w = Math.max(4, (r.value / max) * width);
        pdf.roundedRect(margin, y, w, 7, 3, 3, "F");
        y += 24;
      }
      y += 8;
    }

    if (s.kind === "notes") {
      for (const item of s.items) {
        const lines = pdf.splitTextToSize(item, width - 18) as string[];
        need(lines.length * 13 + 10);
        pdf.setFillColor(...SAPPHIRE);
        pdf.circle(margin + 3, y - 3, 2, "F");
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9.5);
        pdf.setTextColor(...INK);
        lines.forEach((l, i) => pdf.text(l, margin + 16, y + i * 13));
        y += lines.length * 13 + 8;
      }
      y += 10;
    }
  }

  footer();
  pdf.save(doc.filename);
}
