// Faz 19 — Tool Approval Queue (admin only). Lists pending tool invocations
// and lets an admin approve/reject them. Backend: /api/tool-approvals/*.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { ToolApprovalsAPI, type ToolApprovalRow } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ShieldCheck, ShieldX, RefreshCw, Inbox } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/approvals")({
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem("user");
      if (!raw) throw redirect({ to: "/login" });
      try {
        const u = JSON.parse(raw);
        const role = String(u?.role || "").toLowerCase();
        if (role !== "admin") throw redirect({ to: "/dashboard" });
      } catch { throw redirect({ to: "/login" }); }
    }
  },
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const [rows, setRows] = useState<ToolApprovalRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await ToolApprovalsAPI.pending();
      setRows(r.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    try {
      const r = await ToolApprovalsAPI.decide(id, approve ? "approved" : "rejected");
      if (r?.ok) {
        toast.success(approve ? "Approved" : "Rejected");
        setRows((prev) => prev.filter((x) => x.id !== id));
      } else {
        toast.error("Action failed");
      }
    } catch (e) {
      toast.error(String((e as Error)?.message || e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Approval Queue</h1>
          <p className="text-sm text-muted-foreground font-mono">Pending tool calls · admin-only</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {rows.length === 0 && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <span className="font-mono text-sm">No pending approvals</span>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {rows.map((row) => {
          const caller = row.requested_by || row.username || row.agent_id || "system";
          return (
            <Card key={row.id}>
              <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="font-mono text-[10px]">{row.tool_id}</Badge>
                    {row.adapter && <Badge variant="secondary" className="font-mono text-[10px]">{row.adapter}</Badge>}
                    {row.risk_level && (
                      <Badge className="font-mono text-[10px] bg-orange-500/80 text-white">risk: {row.risk_level}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">caller: {caller}</span>
                  </div>
                  {row.started_at && (
                    <p className="text-[10px] text-muted-foreground font-mono">{new Date(row.started_at).toLocaleString()}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="default" disabled={busyId === row.id} onClick={() => decide(row.id, true)}>
                    <ShieldCheck className="h-4 w-4 mr-1" /> Approve
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busyId === row.id} onClick={() => decide(row.id, false)}>
                    <ShieldX className="h-4 w-4 mr-1" /> Reddet
                  </Button>
                </div>
              </CardHeader>
              {row.params ? (
                <CardContent className="pt-0">
                  <pre className="text-[11px] font-mono bg-muted/40 p-2 rounded overflow-x-auto max-h-40">{JSON.stringify(row.params, null, 2)}</pre>
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
