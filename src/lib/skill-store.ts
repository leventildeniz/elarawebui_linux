import { seedNow } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import { readDesk, writeDesk, readDeskRaw, writeDeskRaw, scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";
import type { JewelName } from "@/lib/avatar-library";
import { emptySkill } from "@/mocks/skills";
import { seedSkills } from "@/mocks/skills";
import { seedSkillSquadMap } from "@/mocks/skills";

/** Elara Sovereign Studio — Skills Engine registry (sealed procedures, !slug triggers). */

export type SkillParam = { id: string; key: string; value: string };

export type SkillRisk = "read" | "write" | "exec" | "destructive";
export type ScriptKind = "js" | "python";
export type TempOverride = "off" | "zero" | "safe-low" | "custom";
export type OutputFormat = "raw" | "json" | "markdown" | "table" | "csv";

export type SkillRun = {
  id: string;
  skillId: string;
  slug: string;
  source: string;
  user: string;
  status: "ok" | "error" | "running";
  startedAt: number;
  durationMs: number;
};

export type StudioSkill = Owned & {
  id: string;
  name: string;
  description: string;
  instructions: string;
  squad: string;
  icon: string;
  type: "native" | "python" | "workflow" | "mcp";
  params: SkillParam[];
  scriptPath: string;
  runtimeId: string;
  workflowId: string;
  mcpClientId: string;
  enabled: boolean;
  system: boolean;
  jewel: JewelName;
  stats: { calls: number; success: number; latencyMs: number };
};

export const riskLevels: SkillRisk[] = ["read", "write", "exec", "destructive"];

export const outputFormats: { id: OutputFormat; label: string }[] = [
  { id: "raw", label: "Raw (no enforcement)" },
  { id: "json", label: "Strict JSON object" },
  { id: "markdown", label: "Markdown document" },
  { id: "table", label: "Markdown table only" },
  { id: "csv", label: "CSV rows only" },
];

export const skillAdapterCatalog: string[] = [];
export const skillTargetCatalog: string[] = [];

const KEY = "sovereign.skills";
const RUNS_KEY = "sovereign.skills.runs";
const EVT = "sovereign:skills";

export { emptySkill };


export { seedSkills };

export { seedSkillSquadMap };

for (const s of seedSkills) s.squad = seedSkillSquadMap[s.id] ?? "Unassigned";

/* ------------------------------------------------------- skill squads */

export type SkillSquad = {
  id: string;
  name: string;
  tone: string;
  ownerId?: string;
  owner_id?: string;
  visibility?: string;
  shared_with?: string[];
  tenant_id?: string;
};

const skillSquadTones = ["sapphire", "emerald", "amethyst", "topaz", "ruby"] as const;

const SQ_KEY = "sovereign.skillSquads";
const SQ_ACTIVE_KEY = "sovereign.skillSquads.active";
const SQ_EVT = "sovereign:skillSquads";

export const seedSkillSquads: SkillSquad[] = [...new Set(seedSkills.map((s) => s.squad))]
  .sort((a, b) => a.localeCompare(b))
  .map((name, i) => ({
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    tone: skillSquadTones[i % skillSquadTones.length]!,
  }));

let _cachedSkillSquads: SkillSquad[] = [];

function readSquads(): SkillSquad[] {
  return readDesk<SkillSquad[]>(SQ_KEY, seedSkillSquads);
}

function writeSquads(list: SkillSquad[]) {
  writeDesk(SQ_KEY, list);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SQ_EVT));
  }
}

function readActiveSquad(): string {
  return readDeskRaw(SQ_ACTIVE_KEY) ?? "all";
}

/** Skill squad registry — drives the header tabs and scopes the library. */
export function useSkillSquads() {
  const [squads, setSquads] = useState<SkillSquad[]>(() => {
    if (_cachedSkillSquads.length > 0) return _cachedSkillSquads;
    const local = readSquads();
    if (local.length > 0) {
      _cachedSkillSquads = local;
      return local;
    }
    return [];
  });
  const [active, setActiveState] = useState<string>(() => readActiveSquad());

  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      try {
        const payload = await fetchApi("/api/skills/squads");
        const data = payload?.items || payload;
        if (mounted && Array.isArray(data)) {
          const mapped: SkillSquad[] = data.map((d: any) => ({
            id: d.name.toLowerCase().replace(/\s+/g, "-"),
            name: d.name,
            tone: d.color || d.tone || "sapphire",
            ownerId: d.ownerId || d.owner_id,
            owner_id: d.owner_id || d.ownerId,
            visibility: d.visibility || "workspace",
            shared_with: d.shared_with || d.sharedWith || [],
          }));

          _cachedSkillSquads = mapped;
          setSquads(mapped);
          writeSquads(mapped);
        }
      } catch (e) {
        console.error("Failed to load skill squads", e);
      }
    };
    sync();

    const onEvt = () => {
      if (mounted) {
        setSquads(_cachedSkillSquads.length > 0 ? _cachedSkillSquads : readSquads());
        setActiveState(readActiveSquad());
      }
    };

    const onIdentitySwitch = () => {
      _cachedSkillSquads = [];
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
    const tone = skillSquadTones[list.length % skillSquadTones.length]!;
    const next = [...list, { id, name: clean, tone }];
    writeSquads(next);
    setSquads(next);
    
    // Push to backend
    fetchApi("/api/skills/squads", {
      method: "POST",
      body: JSON.stringify({ name: clean, color: tone })
    }).catch(e => console.error("Failed to persist skill squad:", e));

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
    fetchApi(`/api/skills/squads/${encodeURIComponent(oldSquad.name)}`, {
      method: "PUT",
      body: JSON.stringify({ name: clean })
    }).catch(e => console.error("Failed to rename skill squad:", e));
  }, []);

  const removeSquad = useCallback((id: string) => {
    const list = readSquads();
    const oldSquad = list.find(s => s.id === id);
    const next = list.filter((s) => s.id !== id);
    writeSquads(next);
    setSquads(next);
    
    // Push to backend
    if (oldSquad) {
      fetchApi(`/api/skills/squads/${encodeURIComponent(oldSquad.name)}`, {
        method: "DELETE"
      }).catch(e => console.error("Failed to remove skill squad:", e));
    }
  }, []);

  return { squads, active, setActive, addSquad, renameSquad, removeSquad };
}

export const seedSkillRuns: SkillRun[] = [];

function read(): StudioSkill[] {
  const items = readDesk<StudioSkill[]>(KEY, []);
  if (!Array.isArray(items) || !items.length) return [];
  return items.map((s) => ({ ...emptySkill, ...s }));
}

function write(list: StudioSkill[]) {
  writeDesk(KEY, list);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

function readRuns(): SkillRun[] {
  return readDesk<SkillRun[]>(RUNS_KEY, []);
}

function writeRuns(list: SkillRun[]) {
  writeDesk(RUNS_KEY, list);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

export function useSkills() {
  const [skills, setSkills] = useState<StudioSkill[]>([]);
  const [runs, setRuns] = useState<SkillRun[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const sync = useCallback(async () => {
    try {
      const [data, runsData] = await Promise.all([
        fetchApi("/api/skills"),
        fetchApi("/api/skills/runs").catch(() => null)
      ]);
      
      if (data && Array.isArray(data) && data.length > 0) {
        const mapped = data.map((s: any) => ({
          ...emptySkill,
          id: s.id,
          name: s.name,
          description: s.description || "",
          instructions: s.instructions || "",
          squad: s.squad || "Unassigned",
          icon: s.icon || "Sparkles",
          type: s.type || "native",
          params: typeof s.params === 'string' ? JSON.parse(s.params) : (s.params || []),
          scriptPath: s.script_path || "",
          runtimeId: s.runtime_id || "",
          workflowId: s.workflow_id || "",
          mcpClientId: s.mcp_client_id || "",
          enabled: !!s.enabled,
          system: !!s.system,
          jewel: s.jewel || "sapphire",
          ownerId: s.owner_id || undefined,
          visibility: s.visibility || "workspace",
          createdAt: new Date(s.updated_at || s.created_at || Date.now()).getTime(),
          stats: { calls: 0, success: 100, latencyMs: 0 },
        }));

        const activeRuns = Array.isArray(runsData) ? runsData : [];

        const runCounts = activeRuns.reduce((acc: any, r: any) => {
          const id = r.skill_id || r.skillId;
          acc[id] = (acc[id] || 0) + 1;
          return acc;
        }, {});

        mapped.forEach((s: any) => {
           s.stats.calls = runCounts[s.id] || 0;
        });

        setSkills(mapped);

        // Dynamically extract missing squads from DB and save them so they never disappear
        const existingSquads = readSquads();
        const existingNames = new Set(existingSquads.map((sq) => sq.name));
        let addedSquads = false;
        const newSquads = [...existingSquads];
        mapped.forEach((s: any) => {
          if (s.squad && s.squad !== "Unassigned" && !existingNames.has(s.squad)) {
            newSquads.push({
              id: s.squad.toLowerCase().replace(/\s+/g, "-"),
              name: s.squad,
              tone: skillSquadTones[newSquads.length % skillSquadTones.length]!
            });
            existingNames.add(s.squad);
            addedSquads = true;
          }
        });
        if (addedSquads) writeSquads(newSquads);

      } else {
        setSkills([]);
      }
      
      if (runsData && Array.isArray(runsData)) {
         setRuns(runsData.map((r: any) => ({
            id: r.id,
            skillId: r.skill_id,
            slug: r.slug,
            source: r.source,
            user: r.user_id || "system",
            status: r.status,
            startedAt: new Date(r.started_at).getTime(),
            durationMs: r.duration_ms || 0
         })));
      } else {
         setRuns([]);
      }
    } catch (err) {
      console.error("Failed to load skills", err);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [sync]);

  const create = useCallback(async (draft: Omit<StudioSkill, "id" | "createdAt">) => {
    const id = `sk.${Math.random().toString(36).slice(2, 8)}`;
    const newSkill = stampOwner({ ...draft, id, createdAt: Date.now() }, "workspace");
    
    try {
      await fetchApi("/api/skills", {
        method: "POST",
        body: JSON.stringify({
          ...newSkill,
          script_path: newSkill.scriptPath,
          runtime_id: newSkill.runtimeId,
          workflow_id: newSkill.workflowId,
          mcp_client_id: newSkill.mcpClientId,
        })
      });
      setSkills((prev) => [...prev, newSkill]);
      window.dispatchEvent(new CustomEvent(EVT));
      return id;
    } catch (err) {
      console.error("Failed to create skill", err);
      throw err;
    }
  }, []);

  const update = useCallback(async (id: string, patch: Partial<StudioSkill>) => {
    try {
      const patched = { ...patch };
      if ('scriptPath' in patched) (patched as any).script_path = patched.scriptPath;
      if ('runtimeId' in patched) (patched as any).runtime_id = patched.runtimeId;
      if ('workflowId' in patched) (patched as any).workflow_id = patched.workflowId;
      if ('mcpClientId' in patched) (patched as any).mcp_client_id = patched.mcpClientId;

      await fetchApi(`/api/skills`, {
        method: "POST",
        body: JSON.stringify({ ...patched, id })
      });

      setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error("Failed to update skill", err);
      throw err;
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await fetchApi(`/api/skills/${id}`, { method: "DELETE" });
      setSkills((prev) => prev.filter((s) => s.id !== id));
      window.dispatchEvent(new CustomEvent(EVT));
    } catch (err) {
      console.error("Failed to delete skill", err);
    }
  }, []);

  const ctx = useOwnerCtx();

  const run = useCallback((s: StudioSkill) => {
    const entry: SkillRun = {
      id: `srun.${Math.random().toString(36).slice(2, 8)}`,
      skillId: s.id,
      slug: s.name.toLowerCase().replace(/\s+/g, '-'),
      source: "console",
      user: "admin",
      status: "ok",
      startedAt: Date.now(),
      durationMs: 800 + Math.floor(Math.random() * 18000),
    };
    setRuns((prev) => {
      const next = [entry, ...prev].slice(0, 200);
      writeRuns(next);
      return next;
    });
    setSkills((prev) => prev.map((skill) => 
      skill.id === s.id 
        ? { ...skill, stats: { ...skill.stats, calls: (skill.stats?.calls || 0) + 1 } }
        : skill
    ));
    return entry;
  }, []);

  /* Skills authored by other principals stay off this desk. */
  const visible = scopeOwned(skills, ctx);

  return { skills: visible, allSkills: skills, ctx, runs, create, update, remove, run };
}
