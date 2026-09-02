import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { HighlightedCode } from "./code-highlight";
import { cn } from "@/lib/utils";

/* ---------- tiny markdown-lite parser (code fences, tables, text) ---------- */

type Block =
  | { type: "code"; lang: string; code: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "text"; text: string };

export function parseBlocks(src: string): Block[] {
  // Strip any raw <think>...</think> or <thought>...</thought> tags from display text
  const cleanSrc = src
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .trim();
  const lines = cleanSrc.split("\n");
  const blocks: Block[] = [];
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) blocks.push({ type: "text", text });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.trimStart().startsWith("```")) {
      flush();
      const lang = line.trim().slice(3).trim() || "text";
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith("```")) {
        code.push(lines[i]!);
        i++;
      }
      blocks.push({ type: "code", lang, code: code.join("\n") });
      continue;
    }

    const isRow = (s?: string) => {
      if (!s) return false;
      const t = s.trim();
      return t.startsWith("|") && (t.endsWith("|") || t.includes("|"));
    };
    const isSep = (s?: string) => !!s && /^\s*\|?[\s:|-]+\|?\s*$/.test(s.trim()) && s.includes("-");
    const cells = (s: string) => {
      let trimmed = s.trim();
      if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
      if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
      return trimmed.split("|").map((c) => c.trim());
    };

    if (isRow(line) && isSep(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isRow(lines[i])) {
        rows.push(cells(lines[i]!));
        i++;
      }
      i--;
      blocks.push({ type: "table", head, rows });
      continue;
    }

    buf.push(line);
  }
  flush();
  return blocks;
}

/* ---------------------------- helpers ---------------------------- */

function useCopy() {
  const [done, setDone] = useState(false);
  return {
    done,
    copy: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      } catch {
        /* clipboard unavailable */
      }
    },
  };
}

function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function IconAction({
  label,
  onClick,
  icon: Icon,
  active,
}: {
  label: string;
  onClick: () => void;
  icon: typeof Copy;
  active?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md transition-colors",
        active
          ? "text-emerald"
          : "text-muted-foreground/55 hover:bg-raised/70 hover:text-foreground",
      )}
    >
      <Icon className="h-[14px] w-[14px]" strokeWidth={1.7} />
    </button>
  );
}

/* ---------------------------- blocks ---------------------------- */

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const { copy, done } = useCopy();
  return (
    <div className="my-4 overflow-hidden rounded-[12px] border border-white/[0.07] bg-[var(--canvas-deep)]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/55">
          {lang}
        </span>
        <div className="flex items-center gap-0.5">
          <IconAction
            label="Copy code"
            icon={done ? Check : Copy}
            active={done}
            onClick={() => void copy(code)}
          />
          <IconAction
            label="Download code"
            icon={Download}
            onClick={() =>
              download(`snippet.${lang === "text" ? "txt" : lang}`, code, "text/plain")
            }
          />
        </div>
      </div>
      <pre className="overflow-x-auto px-4 py-3">
        <code className="font-mono text-[13px] leading-[1.7] text-foreground/90">
          <HighlightedCode code={code} />
        </code>
      </pre>
    </div>
  );
}

function TableBlock({ head, rows }: { head: string[]; rows: string[][] }) {
  const { copy, done } = useCopy();
  const csv = [head, ...rows]
    .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\n");

  return (
    <div className="my-4 overflow-hidden rounded-[12px] border border-white/[0.07] bg-panel/60">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/55">
          table
        </span>
        <div className="flex items-center gap-0.5">
          <IconAction
            label="Copy table"
            icon={done ? Check : Copy}
            active={done}
            onClick={() => void copy(csv)}
          />
          <IconAction
            label="Download CSV"
            icon={Download}
            onClick={() => download("table.csv", csv, "text/csv")}
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {head.map((h) => (
                <th
                  key={h}
                  className="border-b border-white/[0.06] px-4 py-2.5 text-[13px] font-semibold text-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="transition-colors hover:bg-raised/30">
                {r.map((c, j) => (
                  <td
                    key={j}
                    className="border-b border-white/[0.04] px-4 py-2.5 align-top text-[13.5px] text-foreground/85"
                  >
                    <Inline text={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Inline `code`, **bold** and plain text. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("`") && p.endsWith("`") && p.length >= 2)
          return (
            <code
              key={i}
              className="rounded-[5px] border border-white/[0.07] bg-raised/60 px-1.5 py-0.5 font-mono text-[12.5px] text-sapphire"
            >
              {p.slice(1, -1)}
            </code>
          );
        if (p.startsWith("**") && p.endsWith("**") && p.length >= 4)
          return (
            <strong key={i} className="font-semibold text-foreground">
              {p.slice(2, -2)}
            </strong>
          );
        // Streaming unclosed bold fallback at tail (e.g. "**Durum: ") to prevent jumping
        if (p.startsWith("**") && !p.slice(2).includes("**")) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {p.slice(2)}
            </strong>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function TextBlock({ text }: { text: string }) {
  return (
    <div className="break-words">
      {text.split("\n").map((line, i) => {
        const h = /^(#{1,3})\s+(.*)$/.exec(line);
        if (h)
          return (
            <h3
              key={i}
              className={cn(
                "font-display font-semibold tracking-[-0.02em] text-foreground",
                h[1]!.length === 1 ? "mt-6 text-[22px]" : "mt-5 text-[18px]",
              )}
            >
              <Inline text={h[2]!} />
            </h3>
          );
        if (/^\s*[-*]\s+/.test(line))
          return (
            <div key={i} className="flex gap-2.5 text-[16px] leading-[1.78] text-foreground/90">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-sapphire" />
              <span>
                <Inline text={line.replace(/^\s*[-*]\s+/, "")} />
              </span>
            </div>
          );
        if (!line.trim()) return <div key={i} className="h-2" />;
        return (
          <p key={i} className="text-[17px] leading-[1.78] tracking-[-0.005em] text-foreground/90">
            <Inline text={line} />
          </p>
        );
      })}
    </div>
  );
}

/** Renders an agent message with code blocks and tables. */
export function RichMessage({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-1">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <CodeBlock key={i} lang={b.lang} code={b.code} />
        ) : b.type === "table" ? (
          <TableBlock key={i} head={b.head} rows={b.rows} />
        ) : (
          <TextBlock key={i} text={b.text} />
        ),
      )}
    </div>
  );
}
