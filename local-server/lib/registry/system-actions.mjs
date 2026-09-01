// lib/registry/system-actions.mjs — Forge action_library seed registry.
// Extracted from server.mjs (Tur 2, 2026-05-30). Consumed by
// createKnowledgeMaintenance (seedForgeLibrary). Pure const data; no deps.

export const SYSTEM_ACTIONS = [
  // Triggers
  { id: "trigger.webhook", kind: "trigger", name: "Webhook", category: "Trigger", icon: "Webhook", color: "#06b6d4",
    description: "Incoming HTTP webhook event",
    params: [{ key: "path", label: "Path", type: "text", default: "/hook" }],
    outputs: [{ key: "payload", label: "Webhook Payload" }],
    runtime: { handler: "builtin", op: "trigger.passthrough" } },
  { id: "trigger.schedule", kind: "trigger", name: "Scheduled (Cron)", category: "Trigger", icon: "Clock", color: "#06b6d4",
    description: "Time-based trigger (cron expression)",
    params: [{ key: "cron", label: "Cron Expression", type: "text", default: "*/5 * * * *", required: true }],
    outputs: [{ key: "ts", label: "Fire Timestamp" }],
    runtime: { handler: "builtin", op: "trigger.passthrough" } },
  { id: "trigger.email", kind: "trigger", name: "New Email", category: "Trigger", icon: "Mail", color: "#06b6d4",
    description: "New email received in mailbox",
    params: [
      { key: "mailbox", label: "Mailbox", type: "text", default: "INBOX" },
      { key: "from", label: "Sender filter", type: "text" },
    ],
    outputs: [
      { key: "subject", label: "Subject" }, { key: "from", label: "From" }, { key: "body", label: "Body" },
    ],
    runtime: { handler: "builtin", op: "trigger.passthrough" } },
  { id: "trigger.cpu_high", kind: "trigger", name: "High CPU Load", category: "Trigger", icon: "Cpu", color: "#ef4444",
    description: "Fires when CPU usage exceeds threshold",
    params: [{ key: "threshold", label: "Threshold %", type: "number", default: 85 }],
    outputs: [{ key: "cpu", label: "CPU %" }],
    runtime: { handler: "builtin", op: "trigger.passthrough" } },

  // Actions — SYS tools are real disk-bound .py scripts. The script: paths are
  // hydrated to absolute paths at boot (see seedForgeLibrary self-heal below).
  { id: "mail.read", kind: "action", name: "Mail · Read", category: "Mail", provider: "email", icon: "Mail", color: "#8b5cf6",
    description: "Read messages from an IMAP mailbox (uses agent vault credentials MAIL_HOST/USER/PASSWORD).",
    params: [
      { key: "sender", label: "Sender filter", type: "text" },
      { key: "mailbox", label: "Mailbox", type: "text", default: "INBOX" },
      { key: "limit", label: "Limit", type: "number", default: 5 },
    ],
    outputs: [{ key: "messages", label: "Messages" }, { key: "count", label: "Count" }],
    runtime: { handler: "python", script: "tools/mail_read.py" } },
  { id: "ai.summarize", kind: "action", name: "AI · Summarize", category: "AI", provider: "llm", icon: "Sparkles", color: "#8b5cf6",
    description: "Local-model summary via ELARA MLX gateway (env ELARA_MLX_URL).",
    params: [
      { key: "input", label: "Input Text", type: "ctxRef", default: "body" },
      { key: "max_words", label: "Max Words", type: "number", default: 80 },
      { key: "model", label: "Model (override)", type: "text" },
    ],
    outputs: [{ key: "summary", label: "Summary" }, { key: "model", label: "Model used" }],
    runtime: { handler: "python", script: "tools/ai_summarize.py" } },
  { id: "log.analyze", kind: "action", name: "Log · Analyze", category: "Security", provider: "siem", icon: "Activity", color: "#10b981",
    description: "Parse log text or a file path, classify severity, return histogram + top errors.",
    params: [
      { key: "source", label: "Log file path (optional)", type: "text" },
      { key: "input", label: "Inline log text", type: "ctxRef" },
    ],
    outputs: [{ key: "severity", label: "Severity" }, { key: "histogram", label: "Histogram" }, { key: "top_errors", label: "Top errors" }],
    runtime: { handler: "python", script: "tools/log_analyze.py" } },
  { id: "social.youtube.upload", kind: "action", name: "YouTube Upload", category: "Social", provider: "youtube", icon: "Youtube", color: "#ef4444",
    description: "Upload a local video file via YouTube Data API v3 (needs YT_ACCESS_TOKEN).",
    params: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "file_path", label: "Local file path", type: "text", required: true },
      { key: "description", label: "Description", type: "textarea" },
      { key: "privacy", label: "Privacy", type: "select", options: ["private","unlisted","public"], default: "private" },
    ],
    outputs: [{ key: "video_id", label: "Video ID" }, { key: "url", label: "URL" }],
    runtime: { handler: "python", script: "tools/youtube_upload.py" } },
  { id: "system.suspend", kind: "action", name: "System · Suspend", category: "System", provider: "system", icon: "Power", color: "#ef4444",
    description: "Suspend / lock down the perimeter",
    params: [{ key: "reason", label: "Reason", type: "text", default: "automated lockdown" }],
    outputs: [{ key: "ok", label: "Suspended" }],
    runtime: { handler: "builtin", op: "system.suspend" } },

  // Logic
  { id: "logic.if", kind: "logic", name: "If · Condition", category: "Logic", icon: "GitBranch", color: "#f59e0b",
    description: "Branch based on a JS-safe expression evaluated against ctx",
    params: [{ key: "expression", label: "Expression", type: "textarea", default: 'ctx.severity === "critical"', required: true }],
    outputs: [{ key: "result", label: "Branch Result (true/false)" }],
    runtime: { handler: "builtin", op: "logic.if" } },

  // Outputs
  { id: "output.telegram", kind: "output", name: "Telegram Send", category: "Notify", provider: "telegram", icon: "Send", color: "#3b82f6",
    description: "Send a message via Telegram Bot API (needs TELEGRAM_BOT_TOKEN).",
    params: [
      { key: "chat_id", label: "Chat ID", type: "text", required: true },
      { key: "text", label: "Text", type: "ctxRef", default: "summary" },
      { key: "parse_mode", label: "Parse mode", type: "select", options: ["", "Markdown", "MarkdownV2", "HTML"], default: "" },
    ],
    outputs: [{ key: "message_id", label: "Message ID" }],
    runtime: { handler: "python", script: "tools/telegram_send.py" } },
  { id: "output.webhook", kind: "output", name: "HTTP Webhook", category: "Notify", provider: "http", icon: "Globe", color: "#3b82f6",
    params: [
      { key: "url", label: "URL", type: "text", required: true },
      { key: "method", label: "Method", type: "select", options: ["POST","PUT","GET"], default: "POST" },
      { key: "body", label: "Body Template", type: "textarea", default: '{"summary":"{{ctx.summary}}"}' },
    ],
    outputs: [{ key: "status", label: "HTTP Status" }],
    runtime: { handler: "http", method: "{{params.method}}", url: "{{params.url}}", body: "{{params.body}}" } },
];

// SYS slugs whose runtime.script we hydrate to absolute paths at boot.
export const SYS_DISK_TOOLS = {
  "mail.read":             "tools/mail_read.py",
  "ai.summarize":          "tools/ai_summarize.py",
  "log.analyze":           "tools/log_analyze.py",
  "social.youtube.upload": "tools/youtube_upload.py",
  "output.telegram":       "tools/telegram_send.py",
};
