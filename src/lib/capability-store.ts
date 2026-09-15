import { seedNow } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import {
  canEdit,
  readDesk,
  writeDesk,
  readDeskRaw,
  writeDeskRaw,
  readOwnerCtx,
  scopeOwned,
  stampOwner,
  useOwnerCtx,
  type Owned,
} from "@/lib/ownership";
import type { JewelName } from "@/lib/avatar-library";

/**
 * Elara Sovereign Studio — Capability Registry.
 *
 * A capability pack is the single source of truth for what an agent can reach:
 * tools, skills and MCP servers, plus the sectoral persona (system prompt
 * overlay), RAG brand filter and default brain / interpreter it inherits.
 */

export type CapabilityPack = {
  id: string;
  name: string;
  sector: string;
  squad: string;
  icon: string;
  jewel: JewelName;
  description: string;
  system: boolean;
  brandKeywords: string[];
  systemOverlay: string;
  brainModelId: string;
  interpreterId: string;
  tools: string[];
  skills: string[];
  mcpServers: string[];
  createdAt: number;
} & Owned;

const KEY = "elara.capabilities.v1";
const EVT = "elara:capabilities";

export const capabilitySectors = [
  "engineering",
  "knowledge",
  "marketing",
  "medical",
  "security",
  "finance",
  "general",
];

export const emptyPack: Omit<CapabilityPack, "id" | "createdAt"> = {
  name: "",
  sector: "general",
  squad: "Unassigned",
  icon: "Shield",
  jewel: "sapphire",
  description: "",
  system: false,
  brandKeywords: [],
  systemOverlay: "",
  brainModelId: "default",
  interpreterId: "auto",
  tools: [],
  skills: [],
  mcpServers: [],
  ownerId: "org",
  ownerName: "",
  visibility: "workspace",
  sharedWith: [],
};

const sectorSquad: Record<string, string> = {
  engineering: "Engineering",
  knowledge: "Knowledge",
  marketing: "Marketing",
  medical: "Medical",
  security: "Security",
  finance: "Finance",
  general: "General",
};

function read(): CapabilityPack[] {
  const items = readDesk<CapabilityPack[]>(KEY, []);
  if (!Array.isArray(items) || !items.length) return [];
  return items.map((p) => ({ ...p, squad: p.squad || sectorSquad[p.sector] || "Unassigned" }));
}

function write(list: CapabilityPack[]) {
  writeDesk(KEY, list);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

export function slugifyPack(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `pack.${base || Math.random().toString(36).slice(2, 7)}`;
}

export function useCapabilities() {
  const ctx = useOwnerCtx();
  const [packs, setPacks] = useState<CapabilityPack[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const sync = useCallback(async () => {
    try {
      const data = await fetchApi("/api/capability-packs");
      const items = data?.items || data;
      
      if (items && Array.isArray(items)) {
        const mapped = items.map((p: any) => ({
          ...emptyPack,
          id: p.id,
          name: p.name,
          sector: p.sector || "general",
          squad: p.squad || "Unassigned",
          icon: p.icon || "Shield",
          jewel: p.color || p.jewel || "sapphire",
          description: p.description || "",
          system: !!p.is_system,
          brandKeywords: typeof p.brand_keywords === 'string' ? JSON.parse(p.brand_keywords) : (p.brand_keywords || []),
          tools: typeof p.action_ids === 'string' ? JSON.parse(p.action_ids) : (p.action_ids || []),
          skills: typeof p.skill_ids === 'string' ? JSON.parse(p.skill_ids) : (p.skill_ids || []),
          mcpServers: typeof p.mcp_server_ids === 'string' ? JSON.parse(p.mcp_server_ids) : (p.mcp_server_ids || []),
          createdAt: new Date(p.updated_at || Date.now()).getTime(),
          ownerId: p.owner_user_id || undefined,
          visibility: p.visibility || "workspace",
          sharedWith: typeof p.shared_with === 'string' ? JSON.parse(p.shared_with) : (p.shared_with || []),
        }));
        setPacks(mapped);

        // Dynamically extract missing squads from DB and save them so they never disappear
        const existingSquads = readSquads();
        const existingNames = new Set(existingSquads.map((sq) => sq.name));
        let addedSquads = false;
        const newSquads = [...existingSquads];
        mapped.forEach((p: any) => {
          if (p.squad && p.squad !== "Unassigned" && !existingNames.has(p.squad)) {
            newSquads.push({
              id: p.squad.toLowerCase().replace(/\s+/g, "-"),
              name: p.squad,
              tone: squadTones[newSquads.length % squadTones.length]!
            });
            existingNames.add(p.squad);
            addedSquads = true;
          }
        });
        if (addedSquads) writeSquads(newSquads);

      } else {
        setPacks([]);
      }
    } catch (err) {
      console.error("Failed to load capability packs", err);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [sync]);

  const create = useCallback(async (draft: Omit<CapabilityPack, "createdAt">) => {
    const id = draft.id || `pack.${Math.random().toString(36).slice(2, 8)}`;
    const newPack = stampOwner({ ...draft, id, createdAt: Date.now() }, "workspace");
    try {
      await fetchApi("/api/capability-packs", {
        method: "POST",
        body: JSON.stringify({
          id,
          name: newPack.name,
          sector: newPack.sector,
          description: newPack.description,
          icon: newPack.icon,
          color: newPack.jewel,
          action_ids: newPack.tools,
          skill_ids: newPack.skills,
          mcp_server_ids: newPack.mcpServers,
          brand_keywords: newPack.brandKeywords,
          default_model: newPack.brainModelId,
          default_interpreter_path: newPack.interpreterId,
          system_prompt: newPack.systemOverlay,
          squad: newPack.squad,
          visibility: newPack.visibility,
          shared_with: newPack.sharedWith,
          ownerId: newPack.ownerId,
          ownerName: newPack.ownerName,
        })
      });
      setPacks((prev) => [...prev, newPack]);
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error("Failed to create capability pack", err);
    }
  }, []);

  const update = useCallback(async (id: string, patch: Partial<CapabilityPack>) => {
    try {
      const patched = { ...patch };
      const reqBody: any = {};
      if (patched.name !== undefined) reqBody.name = patched.name;
      if (patched.sector !== undefined) reqBody.sector = patched.sector;
      if (patched.description !== undefined) reqBody.description = patched.description;
      if (patched.icon !== undefined) reqBody.icon = patched.icon;
      if (patched.jewel !== undefined) reqBody.color = patched.jewel;
      if (patched.tools !== undefined) reqBody.action_ids = patched.tools;
      if (patched.skills !== undefined) reqBody.skill_ids = patched.skills;
      if (patched.mcpServers !== undefined) reqBody.mcp_server_ids = patched.mcpServers;
      if (patched.brandKeywords !== undefined) reqBody.brand_keywords = patched.brandKeywords;
      if (patched.brainModelId !== undefined) reqBody.default_model = patched.brainModelId;
      if (patched.interpreterId !== undefined) reqBody.default_interpreter_path = patched.interpreterId;
      if (patched.systemOverlay !== undefined) reqBody.system_prompt = patched.systemOverlay;
      if (patched.squad !== undefined) reqBody.squad = patched.squad;
      if (patched.visibility !== undefined) reqBody.visibility = patched.visibility;
      if (patched.sharedWith !== undefined) reqBody.shared_with = patched.sharedWith;

      await fetchApi(`/api/capability-packs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(reqBody)
      });
      setPacks((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error("Failed to update capability pack", err);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await fetchApi(`/api/capability-packs/${id}`, { method: "DELETE" });
      setPacks((prev) => prev.filter((p) => p.id !== id));
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error("Failed to remove capability pack", err);
    }
  }, []);

  const duplicate = useCallback(async (id: string) => {
    const src = packs.find((p) => p.id === id);
    if (!src) return;
    const copyId = `pack.${Math.random().toString(36).slice(2, 8)}`;
    const copy: CapabilityPack = {
      ...src,
      id: copyId,
      name: `${src.name} copy`,
      system: false,
      createdAt: Date.now(),
    };
    await create(copy);
  }, [packs, create]);

  const reset = useCallback(() => {}, []);

  const visible = scopeOwned(packs, ctx);
  return { packs: visible, allPacks: packs, hydrated, ctx, create, update, remove, duplicate, reset };
}

/* ---------------------------------------------------- capability squads */

export type CapabilitySquad = {
  id: string;
  name: string;
  tone: string;
  ownerId?: string;
  owner_id?: string;
  visibility?: string;
  shared_with?: string[];
  tenant_id?: string;
};

const squadTones = ["sapphire", "emerald", "amethyst", "topaz", "ruby"] as const;

const SQ_KEY = "elara.capabilitySquads.v1";
const SQ_ACTIVE_KEY = "elara.capabilitySquads.active";
const SQ_EVT = "elara:capabilitySquads";

let _cachedCapabilitySquads: CapabilitySquad[] = [];

export const seedCapabilitySquads: CapabilitySquad[] = [];

function readSquads(): CapabilitySquad[] {
  return readDesk<CapabilitySquad[]>(SQ_KEY, seedCapabilitySquads);
}

function writeSquads(list: CapabilitySquad[]) {
  writeDesk(SQ_KEY, list);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SQ_EVT));
  }
}

function readActiveSquad(): string {
  return readDeskRaw(SQ_ACTIVE_KEY) ?? "all";
}

/** Capability squad registry — drives the header tabs and scopes the registry. */
export function useCapabilitySquads() {
  const [squads, setSquads] = useState<CapabilitySquad[]>(() => {
    if (_cachedCapabilitySquads.length > 0) return _cachedCapabilitySquads;
    const local = readSquads();
    if (local.length > 0) {
      _cachedCapabilitySquads = local;
      return local;
    }
    return [];
  });
  const [active, setActiveState] = useState<string>(() => readActiveSquad());

  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      try {
        const payload = await fetchApi("/api/capabilities/squads");
        const data = payload?.items || payload;
        if (mounted && Array.isArray(data)) {
          const mapped: CapabilitySquad[] = data.map((d: any) => ({
            id: d.name.toLowerCase().replace(/\s+/g, "-"),
            name: d.name,
            tone: d.color || d.tone || "sapphire",
            ownerId: d.ownerId || d.owner_id,
            owner_id: d.owner_id || d.ownerId,
            visibility: d.visibility || "workspace",
            shared_with: d.shared_with || d.sharedWith || [],
          }));

          _cachedCapabilitySquads = mapped;
          setSquads(mapped);
          writeSquads(mapped);
        }
      } catch (e) {
        console.error("Failed to load capability squads", e);
      }
    };
    sync();

    const onEvt = () => {
      if (mounted) {
        setSquads(_cachedCapabilitySquads.length > 0 ? _cachedCapabilitySquads : readSquads());
        setActiveState(readActiveSquad());
      }
    };

    const onIdentitySwitch = () => {
      _cachedCapabilitySquads = [];
      if (mounted) {
        setSquads([]);
        setActiveState("all");
        sync();
      }
    };

    window.addEventListener(SQ_EVT, onEvt);
    window.addEventListener("storage", onEvt);
    window.addEventListener("sovereign:identity", onIdentitySwitch);
    return () => {
      mounted = false;
      window.removeEventListener(SQ_EVT, onEvt);
      window.removeEventListener("storage", onEvt);
      window.removeEventListener("sovereign:identity", onIdentitySwitch);
    };
  }, []);

  const setActive = useCallback((id: string) => {
    writeDeskRaw(SQ_ACTIVE_KEY, id);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SQ_EVT));
    }
    setActiveState(id);
  }, []);

  const addSquad = useCallback((name: string) => {
    const clean = name.trim() || "New Squad";
    const list = readSquads();
    const id = `${clean.toLowerCase().replace(/\s+/g, "-")}.${Math.random().toString(36).slice(2, 5)}`;
    const tone = squadTones[list.length % squadTones.length]!;
    const next = [...list, { id, name: clean, tone }];
    writeSquads(next);
    setSquads(next);
    // Push to backend
    fetchApi("/api/capabilities/squads", {
      method: "POST",
      body: JSON.stringify({ name: clean, color: tone })
    }).catch(e => console.error("Failed to persist capability squad:", e));
    return id;
  }, []);

  const renameSquad = useCallback((id: string, name: string) => {
    const list = readSquads();
    const oldSquad = list.find(s => s.id === id);
    const clean = name.trim() || (oldSquad ? oldSquad.name : "");
    if (!oldSquad || !clean) return;
    
    const next = list.map((s) => (s.id === id ? { ...s, name: clean } : s));
    writeSquads(next);
    setSquads(next);
    
    // Push to backend
    fetchApi(`/api/capabilities/squads/${encodeURIComponent(oldSquad.name)}`, {
      method: "PUT",
      body: JSON.stringify({ name: clean })
    }).catch(e => console.error("Failed to rename capability squad:", e));
  }, []);

  const removeSquad = useCallback((id: string) => {
    const list = readSquads();
    const oldSquad = list.find(s => s.id === id);
    const next = list.filter((s) => s.id !== id);
    writeSquads(next);
    setSquads(next);
    
    // Push to backend
    if (oldSquad) {
      fetchApi(`/api/capabilities/squads/${encodeURIComponent(oldSquad.name)}`, {
        method: "DELETE"
      }).catch(e => console.error("Failed to remove capability squad:", e));
    }
  }, []);

  return { squads, active, setActive, addSquad, renameSquad, removeSquad };
}
