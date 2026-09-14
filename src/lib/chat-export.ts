import type { ChatThread } from "./chat-store";

function transcript(chat: ChatThread) {
  if (!chat.messages.length) return "_No messages recorded in this thread yet._";
  return chat.messages
    .map((m) => `**${m.role === "user" ? "You" : "Elara"}**\n\n${m.text}`)
    .join("\n\n---\n\n");
}

export function chatToMarkdown(chat: ChatThread) {
  const date = new Date(chat.createdAt).toISOString();
  return `# ${chat.title}\n\n> Elara Sovereign Studio — exported ${date}\n\n${transcript(chat)}\n`;
}

function slug(title: string) {
  return title.replace(/[^\w-]+/g, "-").toLowerCase();
}

export function downloadMarkdown(chat: ChatThread) {
  const blob = new Blob([chatToMarkdown(chat)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug(chat.title)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Converts chat Markdown text into structured, publication-grade HTML for PDF generation. */
function markdownToHtml(md: string): string {
  if (!md) return "";

  // 1. Extract and preserve code blocks
  const codeBlocks: string[] = [];
  let html = md.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const escaped = escapeHtml(code);
    codeBlocks.push(
      `<div class="pdf-code-block"><div class="pdf-code-header">${escapeHtml(lang || "code")}</div><pre><code>${escaped}</code></pre></div>`
    );
    return `__CODE_BLOCK_${idx}__`;
  });

  // 2. Parse Markdown Tables
  html = html.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (tableMatch) => {
    const rows = tableMatch.trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    if (rows.length < 2) return tableMatch;

    const isTable = rows[1]?.includes("-");
    if (!isTable) return tableMatch;

    const parseRow = (r: string) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const headerCells = parseRow(rows[0] ?? "");
    const bodyRows = rows.slice(2);

    const thead = `<thead><tr>${headerCells.map((c) => `<th>${formatInline(c)}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody>${bodyRows
      .map((r) => {
        const cells = parseRow(r);
        return `<tr>${cells.map((c) => `<td>${formatInline(c)}</td>`).join("")}</tr>`;
      })
      .join("")}</tbody>`;

    return `<table class="pdf-table">${thead}${tbody}</table>`;
  });

  // 3. Helper for inline formatting
  function formatInline(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/`([^`]+)`/g, '<code class="pdf-inline-code">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/_([^_]+)_/g, "<em>$1</em>");
  }

  // 4. Block-level parsing
  const lines = html.split(/\r?\n/);
  const outLines: string[] = [];
  let inList = false;
  let inOrderedList = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] ?? "";

    // Restore Code Block
    if (line.includes("__CODE_BLOCK_")) {
      if (inList) { outLines.push("</ul>"); inList = false; }
      if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
      line = line.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[Number(idx)] || "");
      outLines.push(line);
      continue;
    }

    // Tables
    if (line.includes("<table") || line.includes("</table>") || line.includes("<thead") || line.includes("<tbody") || line.includes("<tr")) {
      if (inList) { outLines.push("</ul>"); inList = false; }
      if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
      outLines.push(line);
      continue;
    }

    // Headings
    if (line.startsWith("#### ")) {
      if (inList) { outLines.push("</ul>"); inList = false; }
      if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
      outLines.push(`<h4 class="pdf-h4">${formatInline(line.slice(5))}</h4>`);
      continue;
    }
    if (line.startsWith("### ")) {
      if (inList) { outLines.push("</ul>"); inList = false; }
      if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
      outLines.push(`<h3 class="pdf-h3">${formatInline(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      if (inList) { outLines.push("</ul>"); inList = false; }
      if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
      outLines.push(`<h2 class="pdf-h2">${formatInline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      if (inList) { outLines.push("</ul>"); inList = false; }
      if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
      outLines.push(`<h1 class="pdf-h1">${formatInline(line.slice(2))}</h1>`);
      continue;
    }

    // Horizontal Rule
    if (/^(\*\*\*|---|___)$/.test(line.trim())) {
      if (inList) { outLines.push("</ul>"); inList = false; }
      if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
      outLines.push('<hr class="pdf-hr" />');
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      if (inList) { outLines.push("</ul>"); inList = false; }
      if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
      outLines.push(`<blockquote class="pdf-quote">${formatInline(line.slice(2))}</blockquote>`);
      continue;
    }

    // Unordered List
    if (/^[\*\-]\s+/.test(line)) {
      if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
      if (!inList) { outLines.push('<ul class="pdf-list">'); inList = true; }
      outLines.push(`<li>${formatInline(line.replace(/^[\*\-]\s+/, ""))}</li>`);
      continue;
    }

    // Ordered List
    if (/^\d+\.\s+/.test(line)) {
      if (inList) { outLines.push("</ul>"); inList = false; }
      if (!inOrderedList) { outLines.push('<ol class="pdf-ordered-list">'); inOrderedList = true; }
      outLines.push(`<li>${formatInline(line.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }

    // Empty line / paragraph break
    if (!line.trim()) {
      if (inList) { outLines.push("</ul>"); inList = false; }
      if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
      continue;
    }

    // Regular paragraph
    if (inList) { outLines.push("</ul>"); inList = false; }
    if (inOrderedList) { outLines.push("</ol>"); inOrderedList = false; }
    outLines.push(`<p class="pdf-p">${formatInline(line)}</p>`);
  }

  if (inList) outLines.push("</ul>");
  if (inOrderedList) outLines.push("</ol>");

  return outLines.join("\n");
}

/** Generates a publication-grade, high-resolution PDF file with full UTF-8 (Turkish) support and sleek Obsidian/Studio styling. */
export async function exportPdf(chat: ChatThread) {
  const { jsPDF } = await import("jspdf");

  const container = document.createElement("div");
  container.className = "pdf-export-root";
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "-9999px";
  container.style.width = "750px";
  container.style.zIndex = "-1000";

  const entries = chat.messages.length
    ? chat.messages
    : [{ role: "agent" as const, text: "No messages recorded in this thread yet." }];

  const dateStr = new Date(chat.createdAt).toLocaleString("tr-TR");
  const titleStr = chat.title || "Untitled Conversation";

  const styles = `
    .pdf-export-root {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1e293b;
      background: #ffffff;
      padding: 32px 36px;
      width: 750px;
      font-size: 13px;
      line-height: 1.6;
      box-sizing: border-box;
    }
    .pdf-header {
      border-bottom: 2px solid #0f52ba;
      padding-bottom: 14px;
      margin-bottom: 22px;
    }
    .pdf-brand {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #0f52ba;
      margin-bottom: 4px;
    }
    .pdf-title {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 6px 0;
      letter-spacing: -0.01em;
    }
    .pdf-meta {
      font-size: 10px;
      color: #64748b;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .pdf-message {
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e2e8f0;
    }
    .pdf-message:last-child {
      border-bottom: none;
    }
    .pdf-role-badge {
      display: inline-block;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 4px;
      margin-bottom: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .pdf-role-user {
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #cbd5e1;
    }
    .pdf-role-agent {
      background: #eef2ff;
      color: #0f52ba;
      border: 1px solid #c7d2fe;
    }
    .pdf-p {
      margin: 0 0 8px 0;
      color: #1e293b;
      word-break: break-word;
    }
    .pdf-h1 { font-size: 17px; font-weight: 700; margin: 14px 0 6px 0; color: #0f172a; }
    .pdf-h2 { font-size: 15px; font-weight: 700; margin: 12px 0 6px 0; color: #0f172a; }
    .pdf-h3 { font-size: 13.5px; font-weight: 600; margin: 10px 0 4px 0; color: #1e293b; }
    .pdf-h4 { font-size: 12.5px; font-weight: 600; margin: 8px 0 4px 0; color: #334155; }
    .pdf-list, .pdf-ordered-list {
      margin: 4px 0 10px 20px;
      padding: 0;
      color: #1e293b;
    }
    .pdf-list li, .pdf-ordered-list li {
      margin-bottom: 3px;
    }
    .pdf-inline-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      background: #f1f5f9;
      color: #0f52ba;
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
    }
    .pdf-code-block {
      background: #0f172a;
      color: #f8fafc;
      border-radius: 6px;
      margin: 10px 0;
      overflow: hidden;
    }
    .pdf-code-header {
      background: #1e293b;
      color: #94a3b8;
      font-size: 9.5px;
      padding: 4px 10px;
      font-family: ui-monospace, SFMono-Regular, monospace;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .pdf-code-block pre {
      margin: 0;
      padding: 8px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
      font-size: 10.5px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .pdf-table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 11px;
      border: 1px solid #cbd5e1;
    }
    .pdf-table th {
      background: #f8fafc;
      color: #334155;
      font-weight: 600;
      text-align: left;
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
    }
    .pdf-table td {
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      color: #1e293b;
    }
    .pdf-table tr:nth-child(even) {
      background: #f8fafc;
    }
    .pdf-quote {
      border-left: 3px solid #0f52ba;
      margin: 8px 0;
      padding: 4px 10px;
      background: #f8fafc;
      color: #475569;
      font-style: italic;
    }
    .pdf-hr {
      border: none;
      border-top: 1px dashed #cbd5e1;
      margin: 14px 0;
    }
    .pdf-footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      font-size: 9.5px;
      color: #94a3b8;
      text-align: center;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
  `;

  const messagesHtml = entries
    .map((m) => {
      const isUser = m.role === "user";
      const roleLabel = isUser ? "YOU" : "ELARA SOVEREIGN ENGINE";
      const badgeClass = isUser ? "pdf-role-user" : "pdf-role-agent";
      const contentHtml = markdownToHtml(m.text || "");
      return `
        <div class="pdf-message">
          <div class="pdf-role-badge ${badgeClass}">${roleLabel}</div>
          <div class="pdf-body">${contentHtml}</div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <style>${styles}</style>
    <div class="pdf-header">
      <div class="pdf-brand">ELARA SOVEREIGN STUDIO · EXECUTIVE TRANSCRIPT</div>
      <h1 class="pdf-title">${escapeHtml(titleStr)}</h1>
      <div class="pdf-meta">Exported: ${dateStr} · Messages: ${entries.length} · Thread: ${escapeHtml(chat.id || "live")}</div>
    </div>
    <div class="pdf-content">
      ${messagesHtml}
    </div>
    <div class="pdf-footer">
      ELARA Sovereign Studio — Enterprise Autonomous AI Operating System — Confidential
    </div>
  `;

  document.body.appendChild(container);

  try {
    const doc = new jsPDF({
      unit: "pt",
      format: "a4",
      orientation: "portrait",
    });

    await doc.html(container, {
      callback: (pdf) => {
        pdf.save(`${slug(titleStr)}.pdf`);
      },
      x: 18,
      y: 18,
      width: 559, // 595.28 - 36 (margin)
      windowWidth: 750,
      html2canvas: {
        scale: 2, // High-res retina scale for razor-sharp vector text
        useCORS: true,
        logging: false,
      },
      autoPaging: "text",
    });
  } catch (err) {
    console.error("[exportPdf] Error rendering PDF:", err);
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}
