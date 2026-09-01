// local-server/lib/meta-forge/refresh.mjs
// After a ForgePlan is applied, DB-only artifacts are already visible, but
// disk-backed tools/agents must be scanned into their source registries before
// capabilities sync can make them live.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanToolsDir, defaultToolsRoots } from "../tools-scan.mjs";
import { scanAgentsDir, defaultAgentsRoots } from "../agents-scan.mjs";
import { syncCapabilitiesFromSources } from "../capability-registry.mjs";
import { buildCapabilityManifest, invalidateManifest } from "../capability/manifest-embed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

function createdKinds(plan) {
  const kinds = new Set();
  for (const item of plan?.create || []) {
    if (item?.kind) kinds.add(String(item.kind));
  }
  return kinds;
}

export async function refreshCapabilitiesAfterForgeApply({ pool, plan }) {
  const kinds = createdKinds(plan);
  const scans = {};
  if (kinds.has("tool")) {
    scans.tools = await scanToolsDir({ pool, roots: defaultToolsRoots(PROJECT_ROOT) });
  }
  if (kinds.has("agent")) {
    scans.agents = await scanAgentsDir({ pool, roots: defaultAgentsRoots(PROJECT_ROOT) });
  }
  const capabilities = await syncCapabilitiesFromSources();

  // Critical: syncCapabilitiesFromSources() updates the DB registry, but the
  // gap detector routes from capability-manifest embeddings. Without clearing
  // this cache, an approved tool/agent remains invisible until process restart
  // and the chat model falls back to hallucinated `@[tool-slug]` calls.
  let manifest = { invalidated: false, rebuildScheduled: false };
  try {
    invalidateManifest();
    manifest.invalidated = true;
    manifest.rebuildScheduled = true;
    void buildCapabilityManifest({ force: true }).catch((e) => {
      console.warn("[meta-forge/refresh] capability manifest rebuild failed:", e?.message || e);
    });
  } catch (e) {
    manifest = { invalidated: false, rebuildScheduled: false, error: String(e?.message || e) };
  }

  return { scans, capabilities, manifest };
}