// Faz 19 — CVE Feed. Read-only list backed by /api/cve.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { CveAPI, type CveItem } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_app/cve")({
  beforeLoad: () => {
    if (typeof window !== "undefined" && !localStorage.getItem("user")) {
      throw redirect({ to: "/login" });
    }
  },
  component: CvePage,
});

function severityColor(sev?: string, cvss?: number) {
  const s = String(sev || "").toLowerCase();
  const score = Number(cvss || 0);
  if (s === "critical" || score >= 9) return "bg-destructive text-destructive-foreground";
  if (s === "high" || score >= 7) return "bg-orange-500/80 text-white";
  if (s === "medium" || score >= 4) return "bg-yellow-500/80 text-black";
  return "bg-muted text-muted-foreground";
}

function CvePage() {
  const [items, setItems] = useState<CveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await CveAPI.list(100);
      setItems(r.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      String(it.cve_id || "").toLowerCase().includes(q) ||
      String(it.summary || "").toLowerCase().includes(q) ||
      String(it.severity || "").toLowerCase().includes(q) ||
      String(it.vendor || "").toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CVE Feed</h1>
          <p className="text-sm text-muted-foreground font-mono">Public vulnerability feed · {items.length} entries</p>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            placeholder="CVE-2024, RCE, openssl…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="font-mono text-sm w-64"
          />
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {filtered.length === 0 && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
            <AlertTriangle className="h-8 w-8" />
            <span className="font-mono text-sm">No matching CVE entries</span>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2">
        {filtered.map((cve) => (
          <Card key={cve.cve_id} className="hover:bg-accent/30 transition-colors">
            <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0 gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono text-[10px]">{cve.cve_id}</Badge>
                  <Badge className={`text-[10px] font-mono ${severityColor(cve.severity, cve.cvss)}`}>
                    {cve.severity || "?"}{Number.isFinite(Number(cve.cvss)) ? ` · ${cve.cvss}` : ""}
                  </Badge>
                  {cve.vendor && <Badge variant="secondary" className="text-[10px] font-mono">{cve.vendor}</Badge>}
                </div>
              </div>
              {cve.url && (
                <Button asChild variant="ghost" size="sm">
                  <a href={cve.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-3 w-3 mr-1" /> Kaynak
                  </a>
                </Button>
              )}
            </CardHeader>
            {cve.summary && (
              <CardContent className="pt-0">
                <p className="text-sm leading-relaxed">{cve.summary}</p>
                {cve.published && <p className="text-[10px] text-muted-foreground font-mono mt-1">{new Date(cve.published).toLocaleString()}</p>}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
