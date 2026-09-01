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

/** Generates a real PDF file and downloads it — no print dialog. */
export async function exportPdf(chat: ChatThread) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 56;
  const width = pageW - margin * 2;
  let y = margin;

  const nextPage = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(17, 17, 19);
  doc.text(doc.splitTextToSize(chat.title, width), margin, y);
  y += 26;

  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 126, 138);
  doc.text(`ELARA SOVEREIGN STUDIO  ·  ${new Date(chat.createdAt).toLocaleString()}`, margin, y);
  y += 22;

  const entries = chat.messages.length
    ? chat.messages
    : [{ role: "agent" as const, text: "No messages recorded in this thread yet." }];

  for (const m of entries) {
    nextPage(48);
    doc.setDrawColor(224, 226, 230);
    doc.line(margin, y, pageW - margin, y);
    y += 18;

    doc.setFont("courier", "bold");
    doc.setFontSize(9);
    doc.setTextColor(15, 82, 186);
    doc.text(m.role === "user" ? "YOU" : "ELARA", margin, y);
    y += 16;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(30, 32, 38);
    for (const line of doc.splitTextToSize(m.text, width) as string[]) {
      nextPage(16);
      doc.text(line, margin, y);
      y += 16;
    }
    y += 12;
  }

  doc.save(`${slug(chat.title)}.pdf`);
}
