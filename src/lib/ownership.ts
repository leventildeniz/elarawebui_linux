import { useCallback, useEffect, useMemo, useState } from "react";
import { currentAccount, readGroups } from "@/lib/group-store";
import { isGodPrincipal } from "@/lib/knowledge-space-store";
import { readEnforcement, readRoleActions } from "@/lib/rbac-store";

/**
 * Elara Sovereign Studio — Ownership Plane.
 *
 * RBAC answers "may this principal open this surface". Ownership answers the
 * second, finer question: "is this row theirs". Every studio object a user can
 * author (agents, skills, workflows, prompts, snippets, memories, threads,
 * pipelines, planners) carries an owner and a visibility band. A principal
 * sees their own desk plus what has been shared with them — never the whole
 * organisation's registry.
 *
 * Records authored before this plane existed (and every seeded record) carry
 * no owner: they resolve as `system` — readable by all, editable by sovereigns
 * and workspace-override principals only.
 */

export type Visibility = "private" | "shared" | "workspace" | "system";

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: "MINE",
  shared: "GROUP",
  workspace: "WORKSPACE",
  system: "SYSTEM",
};

export const VISIBILITY_HINTS: Record<Visibility, string> = {
  private: "Only you. The default for everything you author.",
  shared: "You and every principal in the groups you shared it with.",
  workspace: "Everyone in this workspace.",
  system: "Shipped with the studio — read-only unless you hold the workspace override.",
};

export const VISIBILITY_TONE: Record<Visibility, string> = {
  private: "sapphire",
  shared: "emerald",
  workspace: "topaz",
  system: "platinum",
};

/** Fields every ownable studio object carries. All optional — legacy safe. */
export type Owned = {
  /** Account id of the principal who authored it. Absent = system seed. */
  ownerId?: string;
  /** Display handle captured at authoring time, for ledgers and cards. */
  ownerName?: string;
  visibility?: Visibility;
  /** Group ids this record is shared into when visibility is `group`. */
  sharedWith?: string[];
};

export type OwnerCtx = {
  userId: string;
  name: string;
  groupIds: string[];
  /** Admin principal — sees and edits every desk. */
  sovereign: boolean;
  /** Holds the `workspace-all` verb (or enforcement is disarmed). */
  override: boolean;
};

export const ANON_CTX: OwnerCtx = {
  userId: "",
  name: "",
  groupIds: [],
  sovereign: false,
  override: false,
};

/** Resolve the signed-in principal without a hook (SSR safe). */
export function readOwnerCtx(): OwnerCtx {
  if (typeof window === "undefined") return ANON_CTX;
  const me = currentAccount();
  if (!me) return ANON_CTX;
  const groupIds = readGroups()
    .filter((g) => g.members.includes(me.id))
    .map((g) => g.id);
  const sovereign = isGodPrincipal(me.id, me.role, groupIds);
  /* Enforcement disarmed = a lab studio: nothing is hidden from anyone. */
  const override = sovereign || !readEnforcement() || readRoleActions().includes("workspace-all");
  return { userId: me.id, name: me.name || me.username, groupIds, sovereign, override };
}

/** Effective band of a record — missing owner means it shipped with the studio. */
export function visibilityOf(rec: Owned | undefined | null): Visibility {
  if (!rec) return "system";
  if (rec.visibility) return rec.visibility;
  return rec.ownerId ? "private" : "system";
}

export function isMine(rec: Owned | undefined | null, ctx: OwnerCtx): boolean {
  if (!rec) return false;
  if (rec.ownerId && ctx.userId && rec.ownerId === ctx.userId) return true;
  if (rec.ownerId && ctx.name && rec.ownerId.toLowerCase() === ctx.name.toLowerCase()) return true;
  if (rec.ownerName && ctx.name && rec.ownerName.toLowerCase() === ctx.name.toLowerCase()) return true;
  return false;
}

/** May this principal see the record at all? */
export function canSee(rec: Owned | undefined | null, ctx: OwnerCtx): boolean {
  if (!rec) return false;
  if (ctx.override) return true;
  if (isMine(rec, ctx)) return true;
  switch (visibilityOf(rec)) {
    case "system":
    case "workspace":
      return true;
    case "shared":
      return (rec.sharedWith ?? []).some((g) => ctx.groupIds.includes(g));
    case "private":
    default:
      return false;
  }
}

/** May this principal mutate or destroy the record? */
export function canEdit(rec: Owned | undefined | null, ctx: OwnerCtx): boolean {
  if (!rec) return false;
  if (ctx.override) return true;
  if (visibilityOf(rec) === "system") return false;
  /* Sharing widens reading, never writing — a shared object stays the author's. */
  return isMine(rec, ctx);
}

/** Why an edit is refused, for the tooltip on a locked control. */
export function editRefusal(rec: Owned | undefined | null, ctx: OwnerCtx): string {
  if (canEdit(rec, ctx)) return "";
  if (visibilityOf(rec) === "system")
    return "System object — shipped with the studio, not editable from this desk.";
  return `Owned by ${rec?.ownerName || "another principal"} — shared with you as read-only.`;
}

/** Stamp a freshly authored draft with the signed-in owner. Private by default. */
export function stampOwner<T extends object>(
  draft: T,
  visibility: Visibility = "private",
): T & Owned {
  const ctx = readOwnerCtx();
  return {
    ...draft,
    ownerId: (draft as Owned).ownerId || ctx.userId,
    ownerName: (draft as Owned).ownerName || ctx.name,
    visibility: (draft as Owned).visibility || visibility,
    sharedWith: (draft as Owned).sharedWith ?? [],
  };
}

/** Filter any collection down to what the signed-in principal may see. */
export function scopeOwned<T extends Owned>(list: T[], ctx: OwnerCtx): T[] {
  return list.filter((r) => canSee(r, ctx));
}

/**
 * Live owner context. Re-resolves on identity, group and RBAC changes so a
 * role swap immediately narrows (or widens) every registry on screen.
 */
export function useOwnerCtx(): OwnerCtx {
  const [ctx, setCtx] = useState<OwnerCtx>(ANON_CTX);

  useEffect(() => {
    const resolve = () => {
      const next = readOwnerCtx();
      setCtx((prev) =>
        prev.userId === next.userId &&
        prev.sovereign === next.sovereign &&
        prev.override === next.override &&
        prev.groupIds.join() === next.groupIds.join()
          ? prev
          : next,
      );
    };
    resolve();
    const evts = ["sovereign:identity", "sovereign:groups", "sovereign:rbac", "storage"];
    evts.forEach((e) => window.addEventListener(e, resolve));
    return () => evts.forEach((e) => window.removeEventListener(e, resolve));
  }, []);

  return ctx;
}

/**
 * The workhorse: give it a raw registry, get back the caller's desk.
 * `visible` is what may be rendered, `mine` what they authored, and the two
 * predicates drive the lock state of every Save / Delete / Share control.
 */
export function useOwned<T extends Owned>(list: T[]) {
  const ctx = useOwnerCtx();

  const visible = useMemo(() => scopeOwned(list, ctx), [list, ctx]);
  const mine = useMemo(() => list.filter((r) => isMine(r, ctx)), [list, ctx]);
  const shared = useMemo(() => visible.filter((r) => !isMine(r, ctx)), [visible, ctx]);

  return {
    ctx,
    visible,
    mine,
    shared,
    /** Count hidden from this desk — surfaced as a quiet "n private to others". */
    hidden: list.length - visible.length,
    canSee: useCallback((r: T | undefined) => canSee(r, ctx), [ctx]),
    canEdit: useCallback((r: T | undefined) => canEdit(r, ctx), [ctx]),
    isMine: useCallback((r: T | undefined) => isMine(r, ctx), [ctx]),
    refusal: useCallback((r: T | undefined) => editRefusal(r, ctx), [ctx]),
  };
}

/* ------------------------------------------------------- per-desk storage */

/**
 * Some objects are not "shared with" anybody by nature — chat threads, memory
 * traces, prompt overrides. Instead of an owner field on every row, their
 * whole storage bucket is namespaced by principal, so one desk can never read
 * another's bucket even by inspecting storage.
 */
export function deskKey(base: string): string {
  const id = readOwnerCtx().userId;
  return id ? `${base}::${id}` : base;
}

/** Legacy (pre-ownership) buckets belong to the founding admin only. */
function legacyOwner(): boolean {
  return readOwnerCtx().userId === "usr.admin";
}

export function readDesk<T>(base: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(deskKey(base));
    if (raw) return JSON.parse(raw) as T;
    if (legacyOwner()) {
      const legacy = window.localStorage.getItem(base);
      if (legacy) return JSON.parse(legacy) as T;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export function readDeskRaw(base: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      window.localStorage.getItem(deskKey(base)) ??
      (legacyOwner() ? window.localStorage.getItem(base) : null)
    );
  } catch {
    return null;
  }
}

export function writeDesk(base: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(deskKey(base), JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function writeDeskRaw(base: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(deskKey(base), value);
  } catch {
    /* ignore */
  }
}
