export type WorkflowNodeKind = "trigger" | "action" | "skill" | "logic" | "output" | "workflow";

export type TriggerSchedule = {
  mode: "manual" | "interval" | "daily" | "weekly" | "monthly" | "cron";
  everyMinutes: number;   // interval
  time: string;           // "HH:mm" for daily/weekly/monthly
  weekday: number;        // 0 = Sunday
  dayOfMonth: number;     // 1..31
  cron: string;           // five-field
  timezone: string;       // IANA
};

export type TriggerBinding = {
  kind: "manual" | "schedule" | "webhook" | "email" | "file";
  // webhook (event-driven, cadence hidden in the UI)
  webhookId: string;            // adapter id from the webhook registry
  method: "ANY" | "POST" | "PUT" | "GET";
  matchPath: string;            // dotted payload path, e.g. "event.type"
  matchValue: string;           // required value at matchPath
  requireSignature: boolean;
  // email (polled — cadence acts as poll interval)
  mailbox: string;              // ops@sovereign.local
  folder: string;               // INBOX, INBOX/Alerts…
  fromFilter: string;           // "*@partner.com"
  subjectContains: string;      // "[INCIDENT]"
  attachmentsOnly: boolean;
  markRead: boolean;
  // file drop (polled)
  watchPath: string;            // /var/sovereign/inbox
  glob: string;                 // *.csv
};

export type OutputBinding = {
  kind: "report" | "email" | "webhook" | "database" | "syslog" | "alarm" | "file";
  onFailure: "halt" | "continue" | "retry";
  retries: number;
  // report
  format: "markdown" | "pdf" | "html" | "json";
  templateId: string;           // reportTemplates ids: executive | usage | cost | operator-roster | operator-detail
  includeCitations: boolean;
  // email
  to: string; cc: string; subject: string; attachArtifact: boolean;
  // webhook push
  webhookId: string; method: "POST" | "PUT" | "PATCH"; urlOverride: string;
  // database
  table: string; writeMode: "insert" | "upsert"; conflictKey: string;
  // syslog
  syslogHost: string; syslogPort: number; facility: string;
  severity: "debug" | "info" | "notice" | "warning" | "error" | "critical";
  // alarm
  channel: "bell" | "siem" | "both";
  // file drop
  path: string; filename: string;
};

export type WorkflowNode = {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  meta: string;
  x: number;
  y: number;
  schedule?: TriggerSchedule;
  binding?: TriggerBinding;
  sink?: OutputBinding;
};

export type WorkflowEdge = { id: string; from: string; to: string };

export type WorkflowDraft = {
  id: string;
  name: string;
  status: "draft" | "live";
  trigger: string;
  runs: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export const workflowDrafts: WorkflowDraft[] = [];

/** Sealed procedures available to drop onto the canvas. */
export const workflowSkills: { id: string; level: "read" | "critical" }[] = [
  { id: "!hook-formula", level: "read" },
  { id: "!adc-tuning", level: "read" },
  { id: "!network-design", level: "read" },
  { id: "!analytics-report", level: "read" },
  { id: "!live-internet-harvester", level: "read" },
  { id: "!caption-localize", level: "read" },
  { id: "!community-reply", level: "read" },
  { id: "!cta-microcopy", level: "read" },
  { id: "!db-hardening", level: "read" },
  { id: "!ddos-runbook", level: "read" },
  { id: "!change-request", level: "read" },
  { id: "!dns-hardening", level: "read" },
  { id: "!visual-brief", level: "read" },
  { id: "!safe-refuse", level: "read" },
  { id: "!vuln-write-up", level: "read" },
  { id: "!firewall-rule-review", level: "read" },
  { id: "!firewall-deploy", level: "critical" },
  { id: "!hashtag-strategy", level: "read" },
  { id: "!crisis-response", level: "read" },
  { id: "!brand-voice", level: "read" },
  { id: "!markdown-report", level: "read" },
  { id: "!incident-triage", level: "read" },
  { id: "!pcap-narrate", level: "read" },
  { id: "!policy-export", level: "read" },
  { id: "!cite-sources", level: "read" },
  { id: "!shell-runbook", level: "critical" },
];

export const workflowActions = [
  "http-request",
  "transform-json",
  "branch-condition",
  "delay",
  "dispatch-agent",
  "persist-artifact",
];

export const workflowsMeta = "3 pipelines · magnetic graph · trigger → action → output";
