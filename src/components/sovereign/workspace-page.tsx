import { Surface, Row } from "./surface";
import { Tag } from "./primitives";

type Jewel = "sapphire" | "emerald" | "amethyst" | "topaz" | "ruby";

export type WorkspaceSpec = {
  title: string;
  meta: string;
  description: string;
  panels: { id: string; label: string; value: string; tone?: Jewel }[];
};

/**
 * Neutral studio surface used by workspaces that are still being wired up.
 * Keeps the visual language identical to the shipped routes.
 */
export function WorkspacePage({ spec }: { spec: WorkspaceSpec }) {
  return (
    <Surface title={spec.title} meta={spec.meta} wide>
      <p className="max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">
        {spec.description}
      </p>

      <div className="mt-10 rounded-xl border border-border/80">
        {spec.panels.map((p) => (
          <Row key={p.id} className="grid-cols-[minmax(0,1fr)_auto] px-6">
            <div className="min-w-0">
              <div className="truncate font-mono text-[13px] text-foreground/95">{p.id}</div>
              <div className="mt-1.5 text-[13.5px] text-muted-foreground">{p.label}</div>
            </div>
            <Tag tone={p.tone ?? "sapphire"}>{p.value}</Tag>
          </Row>
        ))}
      </div>
    </Surface>
  );
}
