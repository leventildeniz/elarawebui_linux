// İzinli Vizyon Profilleri seçici — kullanıcı / şablon kartlarına eklenir.
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useVisionConfig } from "@/lib/vision-config-store";
import { useAllowedVisionProfiles } from "@/lib/vision-allowed-store";
import { useI18n } from "@/lib/i18n";

export function AllowedVisionProfilesChips({
  scope,
  id,
}: {
  scope: "users" | "templates";
  id: string | undefined;
}) {
  const { profiles } = useVisionConfig();
  const { t } = useI18n();
  const [allowed, setAllowed] = useAllowedVisionProfiles(scope, id);

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label>{t("vision.allowed.title")}</Label>
        <Badge variant="outline" className="text-[10px] font-mono">
          {allowed.length || t("users.models_all")}/{profiles.length || "—"}
        </Badge>
      </div>
      <p className="text-[10px] font-mono text-muted-foreground">
        {t("vision.allowed.hint")}
      </p>
      <div className="flex items-center gap-2 mb-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] font-mono"
          onClick={() => setAllowed(profiles.map((p) => p.id))}
        >
          {t("users.select_all")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] font-mono"
          onClick={() => setAllowed([])}
        >
          {t("users.select_none")}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {profiles.length === 0 && (
          <span className="text-[10px] font-mono text-muted-foreground">
            {t("vision.allowed.empty")}
          </span>
        )}
        {profiles.map((p) => {
          const on = allowed.includes(p.id);
          return (
            <button
              key={p.id}
              onClick={() =>
                setAllowed(on ? allowed.filter((x) => x !== p.id) : [...allowed, p.id])
              }
              className={`text-[11px] font-mono border rounded px-2 py-1 ${on ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`}
            >
              {on ? "✓ " : ""}{p.name}
              {p.isDefault && <span className="ml-1 text-[9px] opacity-60">★</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
