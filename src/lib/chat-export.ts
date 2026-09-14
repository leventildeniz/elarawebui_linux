import type { ChatThread } from "./chat-store";
import { ensureUnicodeFont } from "./pdf-fonts";

function parseSafeDate(d: any): Date {
  if (!d) return new Date();
  if (d instanceof Date && !isNaN(d.getTime())) return d;
  const parsed = new Date(d);
  if (!isNaN(parsed.getTime())) return parsed;
  const num = Number(d);
  if (!isNaN(num) && num > 0) {
    const numDate = new Date(num);
    if (!isNaN(numDate.getTime())) return numDate;
  }
  return new Date();
}

function transcript(chat: ChatThread) {
  const msgs = chat?.messages || [];
  if (!msgs.length) return "_No messages recorded in this thread yet._";
  return msgs
    .map((m) => `**${m.role === "user" ? "You" : "Elara"}**\n\n${m.text || ""}`)
    .join("\n\n---\n\n");
}

export function chatToMarkdown(chat: ChatThread) {
  const date = parseSafeDate(chat?.createdAt).toISOString();
  return `# ${chat?.title || "Untitled Conversation"}\n\n> Elara Sovereign Studio — exported ${date}\n\n${transcript(chat)}\n`;
}

function slug(title: string) {
  return String(title || "chat").replace(/[^\w-]+/g, "-").toLowerCase();
}

export function downloadMarkdown(chat: ChatThread) {
  const titleStr = chat?.title || "chat";
  const blob = new Blob([chatToMarkdown(chat)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug(titleStr)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Generates a vector PDF file with 100% full UTF-8 Turkish support and executive styling. */
export async function exportPdf(chat: ChatThread) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const fontFamily = await ensureUnicodeFont(doc);

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 44;
  const width = pageW - margin * 2;
  let y = 0;
  let page = 0;

  const SAPPHIRE = [15, 82, 186] as const;
  const DARK = [15, 23, 42] as const;
  const MUTED = [100, 116, 139] as const;
  const BORDER = [226, 232, 240] as const;
  const TEXT = [30, 41, 59] as const;

  const header = () => {
    page += 1;
    doc.setFillColor(...DARK);
    doc.rect(0, 0, pageW, 76, "F");
    doc.setFillColor(...SAPPHIRE);
    doc.rect(0, 74, pageW, 2.5, "F");

    doc.setFont(fontFamily, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(147, 197, 253);
    doc.text("ELARA SOVEREIGN STUDIO · EXECUTIVE TRANSCRIPT", margin, 28);

    doc.setFont(fontFamily, "bold");
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    const titleLines = doc.splitTextToSize(chat.title || "Untitled Conversation", width);
    doc.text(titleLines[0] || "", margin, 48);

    doc.setFont(fontFamily, "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Exported: ${parseSafeDate(chat?.createdAt).toLocaleString("tr-TR")} · Messages: ${chat?.messages?.length || 0} · Thread: ${chat?.id || "live"}`,
      margin,
      64
    );

    y = 96;
  };

  const footer = () => {
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.5);
    doc.line(margin, pageH - 36, pageW - margin, pageH - 36);
    doc.setFont(fontFamily, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("ELARA Sovereign Studio — Confidential", margin, pageH - 22);
    doc.text(`PAGE ${page}`, pageW - margin, pageH - 22, { align: "right" });
  };

  const need = (h: number) => {
    if (y + h > pageH - 52) {
      footer();
      doc.addPage();
      header();
    }
  };

  header();

  const entries = chat.messages.length
    ? chat.messages
    : [{ role: "agent" as const, text: "No messages recorded in this thread yet." }];

  for (const m of entries) {
    const isUser = m.role === "user";
    const roleLabel = isUser ? "YOU" : "ELARA SOVEREIGN ENGINE";
    need(40);

    // Role badge pill
    doc.setFillColor(isUser ? 241 : 238, isUser ? 245 : 242, isUser ? 249 : 255);
    doc.setDrawColor(isUser ? 203 : 199, isUser ? 213 : 210, isUser ? 225 : 254);
    doc.roundedRect(margin, y, 160, 18, 4, 4, "FD");

    doc.setFont(fontFamily, "bold");
    doc.setFontSize(8);
    doc.setTextColor(isUser ? 51 : 15, isUser ? 65 : 82, isUser ? 85 : 186);
    doc.text(roleLabel, margin + 8, y + 12);
    y += 26;

    // Parse message content lines
    const rawLines = (m.text || "").split(/\r?\n/);
    let inCodeBlock = false;
    let codeBuffer: string[] = [];

    for (let i = 0; i < rawLines.length; i++) {
      let line = rawLines[i] ?? "";

      // Handle Code Block start/end
      if (line.trim().startsWith("```")) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBuffer = [];
          continue;
        } else {
          inCodeBlock = false;
          // Render accumulated code block
          const codeText = codeBuffer.join("\n");
          const codeLines = doc.splitTextToSize(codeText, width - 20) as string[];
          const blockH = codeLines.length * 11 + 14;
          need(blockH + 8);
          doc.setFillColor(15, 23, 42);
          doc.roundedRect(margin, y, width, blockH, 4, 4, "F");
          doc.setFont(fontFamily, "normal");
          doc.setFontSize(8.5);
          doc.setTextColor(248, 250, 252);
          codeLines.forEach((cl, ci) => {
            doc.text(cl, margin + 10, y + 12 + ci * 11);
          });
          y += blockH + 8;
          continue;
        }
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // Skip empty lines with minimal spacing
      if (!line.trim()) {
        y += 4;
        continue;
      }

      // Horizontal rule
      if (/^(\*\*\*|---|___)$/.test(line.trim())) {
        need(14);
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.5);
        doc.line(margin, y + 4, pageW - margin, y + 4);
        y += 12;
        continue;
      }

      // Markdown Table Row
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        if (line.includes("---")) {
          // Separator row, skip
          continue;
        }
        const cells = line
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim().replace(/\*\*/g, ""));
        const colW = width / Math.max(1, cells.length);
        need(18);
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, width, 16, "F");
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.4);
        doc.rect(margin, y, width, 16, "S");
        doc.setFont(fontFamily, "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...TEXT);
        cells.forEach((cell, ci) => {
          const splitCell = doc.splitTextToSize(cell, colW - 8) as string[];
          doc.text(splitCell[0] || "", margin + ci * colW + 4, y + 11);
        });
        y += 16;
        continue;
      }

      // Headings
      let isHeading = false;
      let headingSize = 10;
      if (line.startsWith("#### ")) {
        line = line.slice(5);
        isHeading = true;
        headingSize = 11;
      } else if (line.startsWith("### ")) {
        line = line.slice(4);
        isHeading = true;
        headingSize = 12;
      } else if (line.startsWith("## ")) {
        line = line.slice(3);
        isHeading = true;
        headingSize = 13;
      } else if (line.startsWith("# ")) {
        line = line.slice(2);
        isHeading = true;
        headingSize = 14.5;
      }

      // Clean inline bold/italic marks for clean vector rendering
      const cleanLine = line
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1");

      const isBullet = /^[\*\-]\s+/.test(cleanLine);
      const displayText = isBullet ? "• " + cleanLine.replace(/^[\*\-]\s+/, "") : cleanLine;

      doc.setFont(fontFamily, isHeading ? "bold" : "normal");
      doc.setFontSize(isHeading ? headingSize : 9.5);
      doc.setTextColor(isHeading ? DARK[0] : TEXT[0], isHeading ? DARK[1] : TEXT[1], isHeading ? DARK[2] : TEXT[2]);

      const wrapWidth = isBullet ? width - 14 : width;
      const wrapped = doc.splitTextToSize(displayText, wrapWidth) as string[];

      for (let wIdx = 0; wIdx < wrapped.length; wIdx++) {
        need(14);
        const xOffset = isBullet && wIdx > 0 ? margin + 10 : margin;
        doc.text(wrapped[wIdx] || "", xOffset, y + 10);
        y += isHeading ? 14 : 12.5;
      }
    }

    // Message separator line
    y += 10;
    need(12);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 14;
  }

  footer();
  doc.save(`${slug(chat.title || "chat")}.pdf`);
}
