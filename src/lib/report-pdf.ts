/**
 * High-fidelity PDF renderer for the Reporting module.
 *
 * Produces a publication-grade, paginated A4 document with 100% full UTF-8
 * (Turkish & international) support, executive styling, KPI grid, zebra tables,
 * metric bars, note items, and crisp 2x retina vector rendering.
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

function escapeHtml(str: string | number): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function exportReportPdf(doc: ReportDoc) {
  const { jsPDF } = await import("jspdf");

  const container = document.createElement("div");
  container.className = "report-pdf-root";
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "-9999px";
  container.style.width = "750px";
  container.style.zIndex = "-1000";

  const dateStr = new Date().toLocaleString("tr-TR");
  const filenameStr = (doc.filename || "report.pdf").replace(/\.pdf$/i, "") + ".pdf";

  const styles = `
    .report-pdf-root {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1e293b;
      background: #ffffff;
      padding: 0 0 32px 0;
      width: 750px;
      font-size: 12px;
      line-height: 1.5;
      box-sizing: border-box;
    }
    .report-header-banner {
      background: #0b0e16;
      border-bottom: 3px solid #1554be;
      padding: 24px 36px 20px 36px;
      color: #ffffff;
    }
    .report-brand-tag {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #93c5fd;
      margin-bottom: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .report-main-title {
      font-size: 21px;
      font-weight: 700;
      color: #ffffff;
      margin: 0 0 6px 0;
      letter-spacing: -0.01em;
    }
    .report-sub-meta {
      font-size: 11px;
      color: #94a3b8;
      display: flex;
      gap: 16px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .report-body {
      padding: 24px 36px 0 36px;
    }
    .report-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 26px;
    }
    .report-kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 14px;
      box-sizing: border-box;
    }
    .report-kpi-label {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 6px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .report-kpi-val {
      font-size: 17px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.2;
    }
    .report-kpi-hint {
      font-size: 9.5px;
      color: #94a3b8;
      margin-top: 4px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .report-section {
      margin-bottom: 24px;
    }
    .report-section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #1554be;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin-bottom: 12px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .report-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      border: 1px solid #cbd5e1;
      margin-bottom: 8px;
    }
    .report-table th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      text-align: left;
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .report-table td {
      padding: 7px 10px;
      border: 1px solid #e2e8f0;
      color: #1e293b;
    }
    .report-table tr:nth-child(even) {
      background: #f8fafc;
    }
    .report-bar-row {
      margin-bottom: 10px;
    }
    .report-bar-labels {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #1e293b;
      margin-bottom: 3px;
    }
    .report-bar-caption {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 10px;
      color: #64748b;
    }
    .report-bar-track {
      height: 7px;
      background: #e2e8f0;
      border-radius: 4px;
      overflow: hidden;
    }
    .report-bar-fill {
      height: 100%;
      background: #1554be;
      border-radius: 4px;
    }
    .report-notes-list {
      margin: 0;
      padding: 0 0 0 16px;
      color: #1e293b;
      font-size: 11.5px;
    }
    .report-notes-list li {
      margin-bottom: 6px;
    }
    .report-footer {
      margin: 28px 36px 0 36px;
      padding-top: 14px;
      border-top: 1px solid #e2e8f0;
      font-size: 9.5px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
  `;

  // Render KPI Grid
  let kpisHtml = "";
  if (doc.kpis && doc.kpis.length > 0) {
    kpisHtml = `
      <div class="report-kpi-grid">
        ${doc.kpis
          .map(
            (k) => `
          <div class="report-kpi-card">
            <div class="report-kpi-label">${escapeHtml(k.label)}</div>
            <div class="report-kpi-val">${escapeHtml(k.value)}</div>
            ${k.hint ? `<div class="report-kpi-hint">${escapeHtml(k.hint)}</div>` : ""}
          </div>
        `
          )
          .join("")}
      </div>
    `;
  }

  // Render Sections
  let sectionsHtml = "";
  if (doc.sections && doc.sections.length > 0) {
    sectionsHtml = doc.sections
      .map((s) => {
        let sectionBody = "";

        if (s.kind === "table") {
          const weights = s.widths ?? s.columns.map(() => 1);
          const totalWeight = weights.reduce((a, b) => a + b, 0);

          const thead = `
            <thead>
              <tr>
                ${s.columns
                  .map((c, i) => {
                    const pct = Math.round(((weights[i] ?? 1) / totalWeight) * 100);
                    return `<th style="width: ${pct}%;">${escapeHtml(c)}</th>`;
                  })
                  .join("")}
              </tr>
            </thead>
          `;

          const tbody = `
            <tbody>
              ${s.rows
                .map(
                  (r) => `
                <tr>
                  ${r.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}
                </tr>
              `
                )
                .join("")}
            </tbody>
          `;

          sectionBody = `<table class="report-table">${thead}${tbody}</table>`;
        } else if (s.kind === "bars") {
          const max = Math.max(1, ...s.rows.map((r) => r.value));
          sectionBody = `
            <div class="report-bars-container">
              ${s.rows
                .map((r) => {
                  const pct = Math.max(2, Math.min(100, Math.round((r.value / max) * 100)));
                  return `
                  <div class="report-bar-row">
                    <div class="report-bar-labels">
                      <span class="report-bar-name">${escapeHtml(r.label)}</span>
                      <span class="report-bar-caption">${escapeHtml(r.caption ?? r.value)}</span>
                    </div>
                    <div class="report-bar-track">
                      <div class="report-bar-fill" style="width: ${pct}%;"></div>
                    </div>
                  </div>
                `;
                })
                .join("")}
            </div>
          `;
        } else if (s.kind === "notes") {
          sectionBody = `
            <ul class="report-notes-list">
              ${s.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          `;
        }

        return `
          <div class="report-section">
            <div class="report-section-title">${escapeHtml(s.title)}</div>
            ${sectionBody}
          </div>
        `;
      })
      .join("");
  }

  container.innerHTML = `
    <style>${styles}</style>
    <div class="report-header-banner">
      <div class="report-brand-tag">ELARA SOVEREIGN STUDIO · ${escapeHtml((doc.period || "EXECUTIVE ROLLUP").toUpperCase())}</div>
      <h1 class="report-main-title">${escapeHtml(doc.title || "Executive Report")}</h1>
      <div class="report-sub-meta">
        <span>${escapeHtml(doc.subtitle || "Sovereign Infrastructure & Operations Ledger")}</span>
      </div>
    </div>
    <div class="report-body">
      ${kpisHtml}
      ${sectionsHtml}
    </div>
    <div class="report-footer">
      <span>ELARA Sovereign Studio — Confidential</span>
      <span>Generated: ${dateStr}</span>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const docPdf = new jsPDF({
      unit: "pt",
      format: "a4",
      orientation: "portrait",
    });

    await docPdf.html(container, {
      callback: (pdf) => {
        pdf.save(filenameStr);
      },
      x: 18,
      y: 18,
      width: 559, // 595.28 - 36 margin
      windowWidth: 750,
      html2canvas: {
        scale: 2, // 2x Retina resolution
        useCORS: true,
        logging: false,
      },
      autoPaging: "text",
    });
  } catch (err) {
    console.error("[exportReportPdf] Error generating report PDF:", err);
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
