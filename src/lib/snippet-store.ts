import { useEffect, useState } from "react";
import { readDesk, writeDesk, scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";
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
  if (typeof window === "undefined") return;
  state = readDesk<Snippet[]>(KEY, seedSnippets);
}

function commit(next: Snippet[]) {
  state = next;
  writeDesk(KEY, next);
  emit();
}

export function useSnippets() {
  const [, force] = useState(0);
  const ctx = useOwnerCtx();
  useEffect(() => {
    hydrate();
    const l = () => force((n) => n + 1);
    const onIdentity = () => {
      hydrate();
      force((n) => n + 1);
    };
    listeners.add(l);
    window.addEventListener("sovereign:identity", onIdentity);
    l();
    return () => {
      listeners.delete(l);
      window.removeEventListener("sovereign:identity", onIdentity);
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
