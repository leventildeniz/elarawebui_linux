import type { ReactNode } from "react";

/** Lightweight, dependency-free syntax highlighter tuned to the jewel palette. */

const KEYWORDS =
  /^(?:let|const|var|fn|func|function|def|class|struct|enum|impl|trait|interface|type|return|if|else|elif|match|switch|case|for|while|loop|in|of|async|await|use|import|from|export|default|pub|mut|new|try|catch|except|finally|with|as|and|or|not|is|None|null|nil|true|false|True|False|self|this|super|yield|break|continue|throw|raise|where|dyn|move|static|extern|unsafe|print|println)$/;

const TYPES = /^(?:[A-Z][A-Za-z0-9_]*)$/;

type Tok = { t: string; c?: string };

const cls: Record<string, string> = {
  comment: "text-muted-foreground/45 italic",
  string: "text-emerald",
  number: "text-topaz",
  keyword: "text-amethyst",
  type: "text-sapphire",
  fn: "text-[color:var(--sapphire)]/85",
  punct: "text-muted-foreground/65",
  attr: "text-ruby",
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const push = (t: string, c?: string) => out.push(c ? { t, c } : { t });

  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);

    // comments
    const line = /^(\/\/|#(?!\[)|--)[^\n]*/.exec(rest);
    if (line) {
      push(line[0], "comment");
      i += line[0].length;
      continue;
    }
    const block = /^\/\*[\s\S]*?\*\//.exec(rest);
    if (block) {
      push(block[0], "comment");
      i += block[0].length;
      continue;
    }
    // attributes / decorators
    const attr = /^(#\[[^\]]*\]|@[A-Za-z_][\w.]*)/.exec(rest);
    if (attr) {
      push(attr[0], "attr");
      i += attr[0].length;
      continue;
    }
    // strings
    const str = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/.exec(rest);
    if (str) {
      push(str[0], "string");
      i += str[0].length;
      continue;
    }
    // numbers
    const num = /^0[xX][0-9a-fA-F_]+|^\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) {
      push(num[0], "number");
      i += num[0].length;
      continue;
    }
    // words
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      const w = word[0];
      const after = src.slice(i + w.length).match(/^\s*\(/);
      push(w, KEYWORDS.test(w) ? "keyword" : after ? "fn" : TYPES.test(w) ? "type" : undefined);
      i += w.length;
      continue;
    }
    // punctuation
    if (/[{}()[\];:,.<>=+\-*/%!&|^~?]/.test(ch)) {
      push(ch, "punct");
      i++;
      continue;
    }
    push(ch);
    i++;
  }
  return out;
}

export function HighlightedCode({ code }: { code: string }): ReactNode {
  const tokens = tokenize(code);
  return (
    <>
      {tokens.map((tok, i) =>
        tok.c ? (
          <span key={i} className={cls[tok.c]}>
            {tok.t}
          </span>
        ) : (
          <span key={i}>{tok.t}</span>
        ),
      )}
    </>
  );
}
