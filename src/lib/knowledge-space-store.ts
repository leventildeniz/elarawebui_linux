import { useCallback, useEffect, useMemo, useState } from "react";
import type { JewelTone } from "@/lib/rbac-store";
import { currentAccount, readGroups } from "@/lib/group-store";

import { fetchApi } from "@/lib/api";

/**
 * Knowledge Spaces — the permission boundary of the RAG layer.
 *
 * A space owns a set of sources. Membership decides two distinct rights:
 *  - readers      → retrieval may search this space's chunks
 *  - contributors → may upload/remove sources inside the space
 *
 * Upload is further narrowed per space by an allowed file-type list and a
 * size ceiling, so "you may only push PDF/XLS here" is expressible.
 *
 * ADMIN IS GOD: the admin role, the Administrators group and the `admin`
 * principal bypass every space check — read, write, type and size.
 */

export type KnowledgeSpace = {
  id: string;
  name: string;
  slug: string;
  description: string;
  tone: JewelTone;
  /** Group ids allowed to query this space. `*` = every authenticated principal. */
  readerGroups: string[];
  /** Individual account ids allowed to query. */
  readerUsers: string[];
  /** Group ids allowed to ingest into this space. */
  contributorGroups: string[];
  /** Individual account ids allowed to ingest. */
  contributorUsers: string[];
  /** Lowercase extensions accepted on upload. Empty = everything the parser supports. */
  allowedTypes: string[];
  /** Per-file ceiling in megabytes. */
  maxMb: number;
};

/** File kinds the ingestion parser understands — used by the space editor. */
export const FILE_TYPES = [
  "pdf",
  "docx",
  "xlsx",
  "csv",
  "pptx",
  "txt",
  "md",
  "json",
  "vsdx",
  "png",
  "mp3",
  "mp4",
  "zip",
] as const;

export const ANY_GROUP = "*";

export const defaultSpaces: KnowledgeSpace[] = [];

const KEY = "sovereign:knowledge:spaces:v1";
const EVT = "sovereign:knowledge:spaces";

function read(): KnowledgeSpace[] {
  if (typeof window === "undefined") return defaultSpaces;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultSpaces;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? (parsed as KnowledgeSpace[]) : defaultSpaces;
  } catch {
    return defaultSpaces;
  }
}

function write(next: KnowledgeSpace[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVT));
}

/** Non-hook read (SSR safe). */
export function readSpaces(): KnowledgeSpace[] {
  return read();
}

export type SpaceCtx = {
  userId: string;
  groupIds: string[];
  /** God mode — admin principals bypass every space rule. */
  sovereign: boolean;
};

export function canReadSpace(space: KnowledgeSpace, ctx: SpaceCtx): boolean {
  if (ctx.sovereign) return true;
  if (space.readerGroups.includes(ANY_GROUP)) return true;
  if (space.readerUsers.includes(ctx.userId)) return true;
  if (space.readerGroups.some((g) => ctx.groupIds.includes(g))) return true;
  return canWriteSpace(space, { ...ctx, sovereign: false });
}

export function canWriteSpace(space: KnowledgeSpace, ctx: SpaceCtx): boolean {
  if (ctx.sovereign) return true;
  if (space.contributorUsers.includes(ctx.userId)) return true;
  return space.contributorGroups.some((g) => ctx.groupIds.includes(g));
}

/** Extension of a filename, lowercase and without the dot. */
export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
}

/**
 * Upload gate for a single file. Returns null when accepted, otherwise a
 * human-readable refusal. Sovereign principals are never refused.
 */
export function checkUpload(
  space: KnowledgeSpace,
  file: { name: string; sizeMb?: number },
  ctx: SpaceCtx,
): string | null {
  if (ctx.sovereign) return null;
  if (!canWriteSpace(space, ctx)) return `You are not a contributor of ${space.name}.`;
  const ext = extOf(file.name);
  if (space.allowedTypes.length && ext && !space.allowedTypes.includes(ext)) {
    return `${space.name} accepts only ${space.allowedTypes.join(" / ").toUpperCase()} — .${ext} rejected.`;
  }
  if (file.sizeMb != null && space.maxMb && file.sizeMb > space.maxMb) {
    return `File is ${file.sizeMb.toFixed(1)} MB — ${space.name} caps uploads at ${space.maxMb} MB.`;
  }
  return null;
}

/** Is this principal an admin (group- or role-wise)? */
export function isGodPrincipal(accountId: string, accountRole: string, groupIds: string[]) {
  if (accountId === "usr.admin") return true;
  if (/^admin(istrator)?s?$/i.test(accountRole.trim())) return true;
  return groupIds.some((g) => /administrators?$/i.test(g));
}

const uid = () => `spc.${Math.random().toString(36).slice(2, 7)}`;

export function useSpaces() {
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>(defaultSpaces);

  useEffect(() => {
    const sync = async () => {
      try {
        const data = await fetchApi("/api/knowledge/spaces");
        if (Array.isArray(data)) {
          const finalData = data.length > 0 ? data : defaultSpaces;
          setSpaces(finalData);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(KEY, JSON.stringify(finalData));
          }
        } else {
          setSpaces(read());
        }
      } catch (err) {
        console.error("Failed to sync knowledge spaces", err);
        setSpaces(read());
      }
    };
    sync();

    const syncLocal = () => setSpaces(read());
    window.addEventListener(EVT, syncLocal);
    window.addEventListener("storage", syncLocal);
    return () => {
      window.removeEventListener(EVT, syncLocal);
      window.removeEventListener("storage", syncLocal);
    };
  }, []);

  const commit = useCallback(async (next: KnowledgeSpace[]) => {
    setSpaces(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(EVT));
    }
  }, []);

  const addSpace = useCallback(async () => {
    const id = uid();
    const next: KnowledgeSpace = {
      id,
      name: "New space",
      slug: id.replace("spc.", ""),
      description: "",
      tone: "topaz",
      readerGroups: [],
      readerUsers: [],
      contributorGroups: [],
      contributorUsers: [],
      allowedTypes: ["pdf"],
      maxMb: 50,
    };
    
    // Optimistic update
    setSpaces((prev) => {
      const updated = [...prev, next];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(KEY, JSON.stringify(updated));
      }
      return updated;
    });

    try {
      await fetchApi("/api/knowledge/spaces", {
        method: "POST",
        body: JSON.stringify(next)
      });
    } catch (e) {
      console.error("Failed to add space to backend:", e);
    }

    return id;
  }, []);

  const updateSpace = useCallback(
    async (id: string, patch: Partial<KnowledgeSpace>) => {
      setSpaces((prev) => {
        const updated = prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
        if (typeof window !== "undefined") {
          window.localStorage.setItem(KEY, JSON.stringify(updated));
        }
        return updated;
      });
      try {
        await fetchApi(`/api/knowledge/spaces/${id}`, {
          method: "PUT",
          body: JSON.stringify(patch)
        });
      } catch (e) {
        console.error("Failed to update space in backend:", e);
      }
    },
    []
  );

  const removeSpace = useCallback(
    async (id: string) => {
      setSpaces((prev) => {
        const updated = prev.filter((s) => s.id !== id);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(KEY, JSON.stringify(updated));
        }
        return updated;
      });
      try {
        await fetchApi(`/api/knowledge/spaces/${id}`, { method: "DELETE" });
      } catch (e) {
        console.error("Failed to remove space from backend:", e);
      }
    },
    []
  );

  const toggleIn = useCallback(
    async (id: string, field: keyof KnowledgeSpace, value: string) => {
      setSpaces((prev) => {
        const s = prev.find((x) => x.id === id);
        if (!s) return prev;
        const current = (s[field] as string[]) ?? [];
        const nextArr = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];

        // Optimistic state
        const nextList = prev.map((x) => (x.id === id ? { ...x, [field]: nextArr } : x));
        if (typeof window !== "undefined") {
          window.localStorage.setItem(KEY, JSON.stringify(nextList));
        }

        // Fire API call asynchronously
        fetchApi(`/api/knowledge/spaces/${id}`, {
          method: "PUT",
          body: JSON.stringify({ [field]: nextArr })
        }).catch(e => console.error("Failed to toggle field:", e));

        return nextList;
      });
    },
    []
  );

  return { spaces, addSpace, updateSpace, removeSpace, toggleIn };
}

/**
 * Space access resolved for the signed-in principal: which spaces they may
 * query, which they may ingest into, and whether they are sovereign.
 */
export function useSpaceAccess() {
  const { spaces } = useSpaces();
  const [ctx, setCtx] = useState<SpaceCtx>({ userId: "", groupIds: [], sovereign: false });

  useEffect(() => {
    const resolve = () => {
      const me = currentAccount();
      if (!me) return;
      const gids = readGroups()
        .filter((g) => g.members.includes(me.id))
        .map((g) => g.id);
      const next: SpaceCtx = {
        userId: me.id,
        groupIds: gids,
        sovereign: isGodPrincipal(me.id, me.role, gids),
      };
      setCtx((prev) =>
        prev.userId === next.userId &&
        prev.sovereign === next.sovereign &&
        prev.groupIds.join() === next.groupIds.join()
          ? prev
          : next,
      );
    };
    resolve();
    window.addEventListener("sovereign:identity", resolve);
    return () => window.removeEventListener("sovereign:identity", resolve);
  }, []);

  const readable = useMemo(() => spaces.filter((s) => canReadSpace(s, ctx)), [spaces, ctx]);
  const writable = useMemo(() => spaces.filter((s) => canWriteSpace(s, ctx)), [spaces, ctx]);

  return {
    ctx,
    spaces,
    readable,
    writable,
    sovereign: ctx.sovereign,
    /**
     * Does this principal have any RAG surface at all? A user (or a whole
     * group) that is neither reader nor contributor of a single space has no
     * business seeing the RAG Documents surface — it stays hidden for them.
     */
    enabled: ctx.sovereign || readable.length > 0 || writable.length > 0,
    /** Can this principal ingest anything anywhere? */
    canIngest: ctx.sovereign || writable.length > 0,

    canRead: (id: string) => {
      const s = spaces.find((x) => x.id === id);
      return s ? canReadSpace(s, ctx) : ctx.sovereign;
    },
    canWrite: (id: string) => {
      const s = spaces.find((x) => x.id === id);
      return s ? canWriteSpace(s, ctx) : ctx.sovereign;
    },
  };
}
