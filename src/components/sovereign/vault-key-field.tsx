import { KeyRound, Pencil } from "lucide-react";
import { type SecretEntry } from "@/lib/security-store";
import { useVaultStore } from "@/lib/vault-store";
import { cn } from "@/lib/utils";

/**
 * Credential binding field with two modes:
 *   vault  → value is a Secret Vault entry id
 *   manual → value is `raw://<raw>` (typed by the operator)
 */

export const RAW_PREFIX = "raw://";
export const VAULT_PREFIX = "vault://";

export const isManualKey = (v: string) => v.startsWith(RAW_PREFIX) || !!(v && !v.startsWith(VAULT_PREFIX));
export const manualValue = (v: string) => v.startsWith(RAW_PREFIX) ? v.slice(RAW_PREFIX.length) : v.startsWith(VAULT_PREFIX) ? "" : v;

export const isVaultKey = (v: string) => v.startsWith(VAULT_PREFIX);
export const vaultValue = (v: string) => v.startsWith(VAULT_PREFIX) ? v.slice(VAULT_PREFIX.length) : "";

import { useEffect } from "react";

export function useVault() {
  const vault = useVaultStore();
  
  useEffect(() => {
    vault.fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  return vault;
}

export function isKeyBound(value: string, items: SecretEntry[]) {
  if (!value) return false;
  if (isManualKey(value)) return manualValue(value).length > 0;
  return items.some((x) => x.id === vaultValue(value) || x.id === value);
}

export function vaultKeyLabel(value: string, items: SecretEntry[]) {
  if (!value) return "unbound";
  if (isManualKey(value)) {
    const raw = manualValue(value);
    return raw ? `bound · manual ${raw.slice(0, 4)}…` : "unbound";
  }
  const vId = vaultValue(value) || value;
  const s = items.find((x) => x.id === vId);
  return s ? `bound · ${s.scope === "global" ? "" : s.scope}${s.name}` : "unbound";
}

const fieldCls =
  "w-full rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 font-mono text-[12.5px] text-foreground outline-none transition-colors focus:border-sapphire/50";

export function VaultKeyField({
  value,
  onChange,
  placeholder = "sk-…",
  className,
}: {
  value: string | undefined | null;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const vault = useVault();
  const safeValue = value || "";
  const manual = isManualKey(safeValue);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1 rounded-lg border border-white/[0.07] bg-black/20 p-1">
        <ModeTab
          active={!manual}
          icon={<KeyRound className="h-3 w-3" strokeWidth={1.8} />}
          label="vault"
          onClick={() => onChange("")}
        />
        <ModeTab
          active={manual}
          icon={<Pencil className="h-3 w-3" strokeWidth={1.8} />}
          label="manual"
          onClick={() => onChange(RAW_PREFIX)}
        />
      </div>

      {manual ? (
        <input
          className={fieldCls}
          type="password"
          autoComplete="off"
          placeholder={placeholder}
          value={manualValue(safeValue)}
          onChange={(e) => onChange(RAW_PREFIX + e.target.value)}
        />
      ) : (
        <select className={fieldCls} value={safeValue} onChange={(e) => onChange(e.target.value)}>
          <option value="" className="bg-canvas">
            — select vault entry —
          </option>
          {vault.items.map((s) => (
            <option key={s.id} value={VAULT_PREFIX + s.id} className="bg-canvas">
              {s.scope === "global" ? "" : s.scope}
              {s.name} · {s.kind}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function ModeTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] transition-colors",
        active
          ? "border border-sapphire/35 bg-sapphire/12 text-sapphire"
          : "border border-transparent text-muted-foreground/60 hover:text-foreground/80",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
