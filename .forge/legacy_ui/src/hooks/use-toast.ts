import { toast as sonnerToast } from "sonner";

type ToastOpts = {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
};

function toast(opts: ToastOpts) {
  const { title, description, variant } = opts;
  const fn = variant === "destructive" ? sonnerToast.error : sonnerToast;
  return fn(title ?? "", { description });
}

export function useToast() {
  return { toast };
}

export { toast };
