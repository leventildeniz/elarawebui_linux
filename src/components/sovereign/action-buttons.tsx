import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import { JewelButton } from "@/components/sovereign/primitives";
import { confirmAction } from "@/components/sovereign/confirm-dialog";

/** Studio-standard sapphire Save button with a short "Saved" acknowledgement. */
export function SaveButton({
  onSave,
  disabled,
  label = "Save",
}: {
  onSave: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <JewelButton
      size="sm"
      variant="primary"
      disabled={disabled}
      onClick={() => {
        onSave();
        setSaved(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setSaved(false), 1600);
      }}
    >
      {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
      {saved ? "Saved" : label}
    </JewelButton>
  );
}

/** Studio-standard reset affordance — always asks for confirmation (ruby tone). */
export function ResetButton({
  onReset,
  title,
  body,
  confirmLabel = "Reset",
  label = "Reset",
  disabled,
}: {
  onReset: () => void;
  title: string;
  body?: string;
  confirmLabel?: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <JewelButton
      size="sm"
      variant="outline"
      disabled={disabled}
      className="hover:border-ruby/45 hover:text-ruby"
      onClick={async () => {
        const ok = await confirmAction({
          title,
          ...(body ? { body } : {}),
          confirmLabel,
          tone: "ruby",
        });
        if (ok) onReset();
      }}
    >
      <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.7} />
      {label}
    </JewelButton>
  );
}
