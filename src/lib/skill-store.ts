import { seedNow } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { fetchApi } from "@/lib/api";
import { scopeOwned, stampOwner, useOwnerCtx, type Owned } from "@/lib/ownership";
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

export type SkillSquad = { id: string; name: string; tone: string };

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

function readSquads(): SkillSquad[] {
  if (typeof window === "undefined") return seedSkillSquads;
  try {
    const raw = window.localStorage.getItem(SQ_KEY);
    if (!raw) return seedSkillSquads;
    const parsed = JSON.parse(raw) as SkillSquad[];
    return Array.isArray(parsed) && parsed.length ? parsed : seedSkillSquads;
  } catch {
    return seedSkillSquads;
  }
}

function writeSquads(list: SkillSquad[]) {
  try {
    window.localStorage.setItem(SQ_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(SQ_EVT));
  } catch {
    /* ignore */
  }
}

function readActiveSquad(): string {
  if (typeof window === "undefined") return "all";
  return window.localStorage.getItem(SQ_ACTIVE_KEY) ?? "all";
}

/** Skill squad registry — drives the header tabs and scopes the library. */
export function useSkillSquads() {
  const [squads, setSquads] = useState<SkillSquad[]>(seedSkillSquads);
  const [active, setActiveState] = useState<string>("all");

  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      setSquads(readSquads());
      setActiveState(readActiveSquad());

      try {
        const payload = await fetchApi("/api/skills/squads");
        const data = payload?.items || payload;
        if (mounted && Array.isArray(data)) {
          const mapped = data.map((d: any) => ({
            id: d.name.toLowerCase().replace(/\s+/g, "-"),
            name: d.name,
            tone: d.color || d.tone || "sapphire"
          }));
          
          const current = readSquads();
          const currentNames = new Set(current.map((sq) => sq.name));
          let changed = false;
          const merged = [...current];

          for (const m of mapped) {
            if (!currentNames.has(m.name)) {
              merged.push(m);
              changed = true;
            } else {
              const idx = merged.findIndex((s) => s.name === m.name);
              const target = merged[idx];
              if (target && target.tone !== m.tone) {
                target.tone = m.tone;
                changed = true;
              }
            }
          }

          if (changed || mapped.length > 0) {
            setSquads(merged);
            window.localStorage.setItem(SQ_KEY, JSON.stringify(merged));
            window.dispatchEvent(new CustomEvent(SQ_EVT));
          }
        }
      } catch (e) {
        console.error("Failed to load skill squads", e);
      }
    };
    sync();
    
    const onEvt = () => {
      setSquads(readSquads());
      setActiveState(readActiveSquad());
    };
    window.addEventListener(SQ_EVT, onEvt);
    return () => {
      mounted = false;
      window.removeEventListener(SQ_EVT, onEvt);
    };
  }, []);

  const setActive = useCallback((id: string) => {
    try {
      window.localStorage.setItem(SQ_ACTIVE_KEY, id);
      window.dispatchEvent(new CustomEvent(SQ_EVT));
    } catch {
      /* ignore */
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
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StudioSkill[];
    if (!Array.isArray(parsed) || !parsed.length) return [];
    return parsed.map((s) => ({ ...emptySkill, ...s }));
  } catch {
    return [];
  }
}

function write(list: StudioSkill[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
  }
}

function readRuns(): SkillRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SkillRun[];
    return Array.isArray(parsed) && parsed.length ? parsed : [];
  } catch {
    return [];
  }
}

function writeRuns(list: SkillRun[]) {
  try {
    window.localStorage.setItem(RUNS_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(EVT));
  } catch {
    /* ignore */
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
