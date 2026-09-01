// local-server/lib/meta-forge/guard.mjs
// Static-lint guard for user-generated Python (tool_forge / agent_forge).
// Phase-1a: DENY list only. Executable-code channels are wired in phase-1b.

const FORBIDDEN_PATTERNS = [
  /\bimport\s+subprocess\b/,
  /\bfrom\s+subprocess\b/,
  /\bos\.system\s*\(/,
  /\bos\.popen\s*\(/,
  /\b__import__\s*\(/,
  /\beval\s*\(/,
  /\bexec\s*\(/,
  /\bcompile\s*\(/,
  /\bopen\s*\(\s*['"]\/(?!tmp\/)/,           // no writes outside /tmp
  /\bsocket\.socket\s*\(/,
  /\bctypes\b/,
];

const REQUIRED_HEADER = /^#!\/usr\/bin\/env\s+python3\s*\n/;

export function lintPython(source, { kind = "tool" } = {}) {
  const errors = [];
  if (typeof source !== "string" || !source.trim()) {
    return { ok: false, errors: ["empty source"] };
  }
  if (!REQUIRED_HEADER.test(source)) {
    errors.push("missing '#!/usr/bin/env python3' shebang");
  }
  for (const rx of FORBIDDEN_PATTERNS) {
    const m = source.match(rx);
    if (m) errors.push(`forbidden pattern: ${m[0]}`);
  }
  if (kind === "tool" && !/^#\s*@tool:\s*[a-zA-Z0-9_-]+/m.test(source)) {
    errors.push("tool must declare '# @tool: <slug>' header");
  }
  if (kind === "agent" && !/^#\s*@tools:/m.test(source)) {
    errors.push("agent must declare '# @tools:' header (use '-' if none)");
  }
  return { ok: errors.length === 0, errors };
}
