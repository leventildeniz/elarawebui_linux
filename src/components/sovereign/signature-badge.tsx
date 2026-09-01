import { FileSignature, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { getSignature, shortHash, type Verdict } from "@/lib/signing";
import { cn } from "@/lib/utils";

const MAP: Record<
  Exclude<Verdict, "off">,
  { label: string; tone: string; Icon: typeof ShieldCheck }
> = {
  signed: {
    label: "SIGNED",
    tone: "border-emerald/40 bg-emerald/10 text-emerald",
    Icon: ShieldCheck,
  },
  unsigned: {
    label: "UNSIGNED",
    tone: "border-topaz/40 bg-topaz/10 text-topaz",
    Icon: ShieldAlert,
  },
  tampered: {
    label: "TAMPERED",
    tone: "border-ruby/45 bg-ruby/12 text-ruby",
    Icon: ShieldX,
  },
};

/** Live signature verdict chip — renders nothing while signed workflows are disabled. */
export function SignatureBadge({ id, verdict }: { id: string; verdict: Verdict }) {
  if (verdict === "off") return null;
  const { label, tone, Icon } = MAP[verdict];
  const rec = verdict === "signed" ? getSignature(id) : null;
  return (
    <span
      title={
        rec
          ? `${rec.algorithm} · ${shortHash(rec.hash)} · key ${rec.fingerprint}`
          : "save this flow to sign it"
      }
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10.5px] tracking-[0.14em]",
        tone,
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={1.7} />
      {label}
      {rec ? (
        <span className="opacity-60">
          <FileSignature className="mr-1 inline h-3 w-3" strokeWidth={1.6} />
          {shortHash(rec.hash)}
        </span>
      ) : null}
    </span>
  );
}
