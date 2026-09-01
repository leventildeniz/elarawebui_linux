// Operator-friendly Capability Matrix — two dropdown+chip pickers.
// Skills and Tools are managed independently. Each list is just chips of
// what's already granted; "+ Add" opens a searchable combobox of remaining
// records. Persists into agent_capabilities (PostgreSQL) via AgentsAPI.
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Sparkles, Wrench, Plus, X, AlertTriangle } from "lucide-react";
import { ForgeAPI, SkillsAPI, type ActionDef, type SkillDef } from "@/lib/api-client";

export interface CapabilitySelection {
  skill_ids: string[];
  tool_ids: string[];
}

interface Props {
  value: CapabilitySelection;
  onChange: (next: CapabilitySelection) => void;
}

export function CapabilityMatrixPicker({ value, onChange }: Props) {
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [tools, setTools] = useState<ActionDef[]>([]);

  useEffect(() => {
    SkillsAPI.list().then(setSkills).catch(() => setSkills([]));
    ForgeAPI.list({ kind: "action" }).then(setTools).catch(() => setTools([]));
  }, []);

  const addSkill = (id: string) => onChange({ ...value, skill_ids: [...new Set([...value.skill_ids, id])] });
  const removeSkill = (id: string) => onChange({ ...value, skill_ids: value.skill_ids.filter((x) => x !== id) });
  const addTool = (id: string) => onChange({ ...value, tool_ids: [...new Set([...value.tool_ids, id])] });
  const removeTool = (id: string) => onChange({ ...value, tool_ids: value.tool_ids.filter((x) => x !== id) });

  const availableSkills = useMemo(
    () => skills.filter((s) => !value.skill_ids.includes(s.id)),
    [skills, value.skill_ids],
  );
  const availableTools = useMemo(
    () => tools.filter((t) => !value.tool_ids.includes(t.id)),
    [tools, value.tool_ids],
  );

  const selectedSkills = useMemo(
    () => value.skill_ids.map((id) => ({ id, rec: skills.find((s) => s.id === id) })),
    [value.skill_ids, skills],
  );
  const selectedTools = useMemo(
    () => value.tool_ids.map((id) => ({ id, rec: tools.find((t) => t.id === id) })),
    [value.tool_ids, tools],
  );

  return (
    <div className="space-y-3">
      {/* Skills */}
      <Section
        icon={Sparkles}
        title="Skills"
        tone="text-primary"
        count={value.skill_ids.length}
        total={skills.length}
        addLabel="Add skill"
        emptyHint="No skills assigned. Click + Add skill to grant access."
        items={availableSkills.map((s) => ({
          id: s.id,
          name: s.name,
          subtitle: `!${s.slug} · ${s.risk_level}`,
          color: s.color,
          isSystem: s.is_system,
          searchKey: `${s.name} ${s.slug} ${s.risk_level}`,
        }))}
        onAdd={addSkill}
      >
        {selectedSkills.map(({ id, rec }) => (
          <Chip
            key={id}
            color={rec?.color}
            name={rec?.name ?? id}
            subtitle={rec ? `!${rec.slug}` : undefined}
            missing={!rec}
            isSystem={rec?.is_system}
            onRemove={() => removeSkill(id)}
          />
        ))}
      </Section>

      {/* Tools */}
      <Section
        icon={Wrench}
        title="Tools"
        tone="text-cyan-300"
        count={value.tool_ids.length}
        total={tools.length}
        addLabel="Add tool"
        emptyHint="No tools assigned. Click + Add tool to grant access."
        items={availableTools.map((t) => ({
          id: t.id,
          name: t.name,
          subtitle: `${t.category} · ${t.id}`,
          color: t.color,
          isSystem: t.is_system,
          searchKey: `${t.name} ${t.id} ${t.category}`,
        }))}
        onAdd={addTool}
      >
        {selectedTools.map(({ id, rec }) => (
          <Chip
            key={id}
            color={rec?.color}
            name={rec?.name ?? id}
            subtitle={rec ? `${rec.category}` : undefined}
            missing={!rec}
            isSystem={rec?.is_system}
            onRemove={() => removeTool(id)}
          />
        ))}
      </Section>
    </div>
  );
}

interface PickerItem {
  id: string;
  name: string;
  subtitle: string;
  color?: string;
  isSystem?: boolean;
  searchKey: string;
}

function Section({
  icon: Icon, title, tone, count, total, addLabel, emptyHint, items, onAdd, children,
}: {
  icon: typeof Sparkles;
  title: string;
  tone: string;
  count: number;
  total: number;
  addLabel: string;
  emptyHint: string;
  items: PickerItem[];
  onAdd: (id: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded p-2 bg-card/40 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className={`h-3.5 w-3.5 ${tone}`} />
          <span className="text-[11px] font-mono uppercase tracking-widest">{title}</span>
          <Badge variant="outline" className="text-[9px] font-mono">{count} / {total}</Badge>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 text-[11px] font-mono">
              <Plus className="h-3 w-3 mr-1" /> {addLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] p-0" align="end">
            <Command>
              <CommandInput placeholder={`Search ${title.toLowerCase()}…`} className="h-9 text-xs" />
              <CommandList className="max-h-64">
                <CommandEmpty className="py-4 text-xs font-mono text-muted-foreground text-center">
                  {items.length === 0 ? `All ${title.toLowerCase()} already granted.` : "No match."}
                </CommandEmpty>
                <CommandGroup>
                  {items.map((it) => (
                    <CommandItem
                      key={it.id}
                      value={it.searchKey}
                      onSelect={() => { onAdd(it.id); setOpen(false); }}
                      className="cursor-pointer"
                    >
                      <span className="h-2 w-2 rounded-full shrink-0 mr-2" style={{ background: it.color || "var(--primary)" }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-mono truncate">{it.name}</p>
                        <p className="text-[9px] font-mono text-muted-foreground truncate">{it.subtitle}</p>
                      </div>
                      {it.isSystem && <Badge variant="outline" className="text-[8px] font-mono ml-2">SYS</Badge>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {count === 0 ? (
        <p className="text-[10px] font-mono text-muted-foreground px-1 py-2">{emptyHint}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">{children}</div>
      )}
    </div>
  );
}

function Chip({
  color, name, subtitle, missing, isSystem, onRemove,
}: {
  color?: string;
  name: string;
  subtitle?: string;
  missing?: boolean;
  isSystem?: boolean;
  onRemove: () => void;
}) {
  return (
    <span
      title={missing ? "Record missing or deleted — click ✕ to clean up" : subtitle}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono ${
        missing
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-primary/30 bg-primary/10"
      }`}
    >
      {missing
        ? <AlertTriangle className="h-3 w-3" />
        : <span className="h-2 w-2 rounded-full" style={{ background: color || "var(--primary)" }} />
      }
      <span className="truncate max-w-[160px]">{name}</span>
      {subtitle && !missing && <span className="text-muted-foreground hidden sm:inline">· {subtitle}</span>}
      {isSystem && !missing && <Badge variant="outline" className="text-[8px] font-mono ml-0.5">SYS</Badge>}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 -mr-1 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
