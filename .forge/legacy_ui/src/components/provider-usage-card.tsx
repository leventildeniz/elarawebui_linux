import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3 } from "lucide-react";
import { ProvidersAPI, type ProviderUsageResponse } from "@/lib/api-client";

export function ProviderUsageCard({ hours = 24, compact = false }: { hours?: number; compact?: boolean }) {
  const [data, setData] = useState<ProviderUsageResponse | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => ProvidersAPI.usage(hours, "hour").then((d) => alive && setData(d)).catch(()=>{});
    tick(); const id = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(id); };
  }, [hours]);

  const totals = data?.totals ?? [];
  const totalTokens = totals.reduce((s, r) => s + r.total_tokens, 0);
  const totalCalls = totals.reduce((s, r) => s + r.calls, 0);

  return (
    <Card className="glass mb-6">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-mono uppercase tracking-widest flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            External Provider Token Usage
          </h3>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">last {hours}h</Badge>
            <Badge variant="outline" className="font-mono text-[10px] text-primary">
              {totalTokens.toLocaleString()} tok · {totalCalls} calls
            </Badge>
          </div>
        </div>
        {totals.length === 0 ? (
          <p className="text-xs text-muted-foreground font-mono p-3 text-center">
            No external provider calls recorded yet. Token usage appears once Remote/Remote/Tavily/Serper are queried.
          </p>
        ) : (
          <div className="border border-border rounded overflow-hidden">
            <div className="grid grid-cols-[1.4fr_70px_1fr_1fr_1fr_70px] gap-2 px-3 py-2 bg-muted/30 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              <span>Provider</span><span>Kind</span><span>Prompt</span><span>Response</span><span>Total</span><span>Calls</span>
            </div>
            {totals.slice(0, compact ? 5 : 50).map((r, i) => (
              <div key={i} className="grid grid-cols-[1.4fr_70px_1fr_1fr_1fr_70px] gap-2 px-3 py-2 border-t border-border text-[11px] font-mono">
                <span className="text-primary truncate">{r.providerName}</span>
                <Badge variant="outline" className="text-[9px] w-fit uppercase">{r.kind}</Badge>
                <span>{r.prompt_tokens.toLocaleString()}</span>
                <span>{r.response_tokens.toLocaleString()}</span>
                <span className="font-bold">{r.total_tokens.toLocaleString()}</span>
                <span>{r.calls}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
