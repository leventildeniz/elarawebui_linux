import {
  AlarmClock,
  AtSign,
  Bell,
  Binary,
  Bot,
  Boxes,
  Brain,
  Braces,
  CalendarClock,
  Cloud,
  Cpu,
  Database,
  FileText,
  FileSpreadsheet,
  Filter,
  FolderInput,
  GitBranch,
  Github,
  Globe,
  Hammer,
  Image as ImageIcon,
  Layers,
  Link2,
  Mail,
  MessageSquare,
  Merge,
  Play,
  Radio,
  Repeat,
  Search,
  Send,
  Server,
  Share2,
  Shield,
  Shuffle,
  Sparkles,
  Split,
  Terminal,
  Timer,
  Upload,
  Webhook,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WorkflowNodeKind } from "@/mocks/workflows";

export type NodeFamily = "trigger" | "agent" | "skill" | "tool" | "mcp" | "logic" | "output" | "workflow";

export const familyTone: Record<NodeFamily, string> = {
  trigger: "sapphire",
  agent: "topaz",
  skill: "amethyst",
  tool: "emerald",
  mcp: "ruby",
  logic: "ruby",
  output: "emerald",
  workflow: "amethyst",
};

export const familyIcon: Record<NodeFamily, LucideIcon> = {
  trigger: Zap,
  agent: Bot,
  skill: Sparkles,
  tool: Wrench,
  mcp: Boxes,
  logic: GitBranch,
  output: Send,
  workflow: Layers,
};

/** Integration glyphs — matched against the node label (n8n-style per-service icons). */
const integrations: { test: RegExp; icon: LucideIcon }[] = [
  { test: /gmail|e-?mail|mail|smtp|imap|inbox/i, icon: Mail },
  { test: /slack|discord|teams|telegram|whatsapp|chat|message/i, icon: MessageSquare },
  { test: /github|git\b|repo|pull request/i, icon: Github },
  {
    test: /postgre|mysql|sqlite|sql|database|\bdb\b|ledger|vector|pinecone|qdrant/i,
    icon: Database,
  },
  { test: /webhook|callback/i, icon: Webhook },
  { test: /cron|schedule|nightly|daily|hourly/i, icon: CalendarClock },
  { test: /timer|delay|wait|interval/i, icon: Timer },
  { test: /alarm|alert|page(r)?duty/i, icon: AlarmClock },
  { test: /notify|notification|push/i, icon: Bell },
  { test: /http|rest|api|fetch|request|curl/i, icon: Globe },
  { test: /search|serp|google|lookup|retriev|rag/i, icon: Search },
  { test: /s3|bucket|storage|cloud|azure|\bgcp\b|aws/i, icon: Cloud },
  { test: /drive|file drop|upload/i, icon: Upload },
  { test: /folder|drop|ingest|intake/i, icon: FolderInput },
  { test: /csv|sheet|excel|table/i, icon: FileSpreadsheet },
  { test: /markdown|report|\bpdf\b|doc(ument)?|write-?up|summary/i, icon: FileText },
  { test: /image|vision|render|screenshot|ocr/i, icon: ImageIcon },
  { test: /json|parse|schema|payload|transform|map/i, icon: Braces },
  { test: /filter|match|where/i, icon: Filter },
  { test: /switch|route|branch|if\b|condition/i, icon: Split },
  { test: /merge|join|aggregate|combine/i, icon: Merge },
  { test: /loop|iterate|each|batch/i, icon: Repeat },
  { test: /random|shuffle|sample/i, icon: Shuffle },
  { test: /shell|bash|command|exec|script/i, icon: Terminal },
  { test: /syslog|log|audit|siem/i, icon: Server },
  { test: /security|guard|policy|approval|compliance|cve|vuln/i, icon: Shield },
  { test: /model|llm|inference|prompt|reason|think/i, icon: Brain },
  { test: /runtime|engine|gpu|cpu|node pool/i, icon: Cpu },
  { test: /forge|build|compile|tool-?chain/i, icon: Hammer },
  { test: /broadcast|publish|social|post/i, icon: Radio },
  { test: /share|fan-?out|dispatch/i, icon: Share2 },
  { test: /stack|layer|pipeline|chain/i, icon: Layers },
  { test: /count|metric|score|token|number/i, icon: Binary },
  { test: /link|connect|bridge/i, icon: Link2 },
  { test: /manual|start|run\b|trigger/i, icon: Play },
];

/** Sigil convention: @agent · !skill · /tool · #mcp */
export function familyOf(kind: WorkflowNodeKind, label = "", meta = ""): NodeFamily {
  const s = label.trim();
  if (s.startsWith("@")) return "agent";
  if (s.startsWith("!")) return "skill";
  if (s.startsWith("/")) return "tool";
  if (s.startsWith("#")) return "mcp";
  if (/\bmcp\b/i.test(meta) || /\bmcp\b/i.test(s)) return "mcp";
  if (/\bagent\b/i.test(meta)) return "agent";
  if (/\btool\b/i.test(meta)) return "tool";
  if (kind === "trigger") return "trigger";
  if (kind === "skill") return "skill";
  if (kind === "logic") return "logic";
  if (kind === "output") return "output";
  if (kind === "workflow" || /\bworkflow\b/i.test(meta)) return "workflow";
  return "tool";
}

export function nodeGlyph(kind: WorkflowNodeKind, label = "", meta = "") {
  const family = familyOf(kind, label, meta);
  const clean = label.replace(/^[@!/#]/, "");
  let icon: LucideIcon | null = null;
  for (const rule of integrations) {
    if (rule.test.test(clean)) {
      icon = rule.icon;
      break;
    }
  }
  // agents keep their identity glyph unless a service is explicit
  if (family === "agent" && !icon) icon = Bot;
  if (family === "mcp" && !icon) icon = Boxes;
  return {
    family,
    tone: familyTone[family],
    Icon: icon ?? familyIcon[family],
    sigil: family === "agent" ? AtSign : null,
  };
}
