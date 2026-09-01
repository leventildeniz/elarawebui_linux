import fs from "node:fs";
import { getRagSettingsPath } from "./state-paths.mjs";

export function getRagSettings() {
  try {
    const path = getRagSettingsPath();
    if (!fs.existsSync(path)) return {};
    const raw = fs.readFileSync(path, "utf8");
    return JSON.parse(raw) || {};
  } catch (e) {
    console.warn("[getRagSettings] read error:", e?.message || e);
    return {};
  }
}
