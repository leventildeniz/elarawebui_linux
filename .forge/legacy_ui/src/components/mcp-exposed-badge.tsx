// Read-only "🌐 Exposed via MCP" chip for agent/tool/skill cards.
// Single source of truth for MCP exposure state lives at /mcp; this chip is a
// pure indicator + deep-link. It fetches once (module-level cache) and shares
// the result across all instances to avoid N calls per card.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { McpAPI, type McpExposure } from "@/lib/api-client";

type Kind = "agent" | "tool" | "skill";

let cache: Set<string> | null = null;
let inflight: Promise<Set<string>> | null = null;
const listeners = new Set<(s: Set<string>) => void>();

function key(kind: Kind, slug: string) {
  return `${kind}:${String(slug || "").toLowerCase()}`;
}

async function loadExposures(): Promise<Set<string>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await McpAPI.getExposures();
      const set = new Set<string>();
      for (const e of (r.exposures || []) as McpExposure[]) {
        if (e.enabled) set.add(key(e.kind as Kind, e.slug));
      }
      cache = set;
      listeners.forEach((fn) => fn(set));
      return set;
    } catch {
      const empty = new Set<string>();
      cache = empty;
      return empty;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Force a refresh (e.g. after toggling from /mcp). Optional; not wired here. */
export function refreshMcpExposedCache() {
  cache = null;
  inflight = null;
  void loadExposures();
}

export function McpExposedBadge({ kind, slug }: { kind: Kind; slug: string | null | undefined }) {
  const [exposed, setExposed] = useState<boolean>(() =>
    cache ? cache.has(key(kind, String(slug || ""))) : false,
  );

  useEffect(() => {
    let alive = true;
    const check = (set: Set<string>) => {
      if (!alive) return;
      setExposed(set.has(key(kind, String(slug || ""))));
    };
    if (cache) check(cache);
    else void loadExposures().then(check);
    listeners.add(check);
    return () => {
      alive = false;
      listeners.delete(check);
    };
  }, [kind, slug]);

  if (!slug || !exposed) return null;

  return (
    <Link
      to="/mcp"
      onClick={(e) => e.stopPropagation()}
      title="This entity is exposed via MCP — click to manage in the MCP tab"
    >
      <Badge
        variant="outline"
        className="text-[9px] gap-1 border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
      >
        <Globe className="h-2.5 w-2.5" />
        MCP
      </Badge>
    </Link>
  );
}
