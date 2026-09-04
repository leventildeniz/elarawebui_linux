// Python interpreter resolution — venv → uv → system.
// Block C Tur 2 — server.mjs'ten taşındı 2026-05-30.
import path from "node:path";
import fs from "node:fs";

export function createPythonResolver({ serverDir }) {
  if (!serverDir) throw new Error("createPythonResolver: serverDir required");
  return function resolvePythonCandidates() {
    const seen = new Set();
    const add = (file, args = []) => {
      const key = `${file}::${args.join("::")}`;
      if (!file || seen.has(key)) return null;
      // Env'den gelen absolute/path-like Python pin'i stale kalmışsa (örn.
      // silinmiş .venv) worker spawn ENOENT ile 360sn beklemesin; fallback
      // adaylarına geçsin. PATH komutları (python3/uv) shell lookup'a bırakılır.
      const pathLike = path.isAbsolute(file) || file.includes("/");
      if (pathLike && !fs.existsSync(file)) return null;
      seen.add(key);
      return { file, args };
    };
    const dotVenvPython = path.join(serverDir, ".venv", "bin", "python");
    const venvPython3 = path.join(serverDir, "venv", "bin", "python3");
    const venvPython = path.join(serverDir, "venv", "bin", "python");
    return [
      add(process.env.PYTHON_BIN || process.env.PYTHON, []),
      fs.existsSync(venvPython3) ? add(venvPython3, []) : null,
      fs.existsSync(venvPython) ? add(venvPython, []) : null,
      fs.existsSync(dotVenvPython) ? add(dotVenvPython, []) : null,
      add("uv", ["run", "python"]),
      add("python3", []),
      add("python", []),
    ].filter(Boolean);
  };
}
