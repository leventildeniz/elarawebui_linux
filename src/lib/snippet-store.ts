import { useEffect, useState } from "react";
import { scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";
import { seedSnippets } from "@/mocks/snippets";

/**
 * Prompt snippets — reusable operator text blocks inserted into the composer
 * with the `>` sigil. Purely additive: they only write into the textarea.
 */
export type Snippet = Owned & {
  id: string;
  name: string;
  body: string;
  tone: string;
};

const KEY = "elara.snippets.v1";

export { seedSnippets };

let state: Snippet[] = seedSnippets;
let hydrated = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) state = JSON.parse(raw) as Snippet[];
  } catch {
    /* ignore */
  }
}

function commit(next: Snippet[]) {
  state = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  emit();
}

export function useSnippets() {
  const [, force] = useState(0);
  const ctx = useOwnerCtx();
  useEffect(() => {
    hydrate();
    const l = () => force((n) => n + 1);
    listeners.add(l);
    l();
    return () => {
      listeners.delete(l);
    };
  }, []);

  return {
    /* Seeded snippets are system-wide; authored ones stay on their desk. */
    snippets: scopeOwned(state, ctx),
    add: (name: string, body: string) => {
      const clean = name.trim().replace(/\s+/g, "-").toLowerCase();
      if (!clean || !body.trim()) return;
      const tones = ["sapphire", "emerald", "amethyst", "topaz"];
      commit([
        stampOwner({
          id: `snip_${Date.now()}`,
          name: clean,
          body: body.trim(),
          tone: tones[state.length % tones.length]!,
        }),
        ...state.filter((s) => s.name !== clean),
      ]);
    },
    remove: (id: string) => commit(state.filter((s) => s.id !== id)),
  };
}
