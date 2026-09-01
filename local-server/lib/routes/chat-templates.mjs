// routes/chat-templates.mjs — UI-facing endpoint for the chat-template registry.
//
// GET /api/system/chat-templates  → [{ id, label, description, pythonSupported }]
// GET /api/system/transports       → [{ id, label, description }]
//
// Bu endpoint UI dropdown'larını (model editör) besler. Sabit liste UI tarafında
// tutulmaz — registry hep tek mercii (lib/chat-templates.mjs).

import { listFamiliesForUi } from "../chat-templates.mjs";

const TRANSPORTS = [
  {
    id: "local_local",
    label: "Local (/v1/completions)",
    description: "Local local server. Uses the chat-template renderer below.",
  },
  {
    id: "remote_compatible",
    label: "Remote-compatible cloud (/v1/chat/completions)",
    description: "Any provider that speaks the standard HTTP shape. Chat template is owned by the provider; the family selector is ignored.",
  },
];

export function mountChatTemplatesRoute(opts) {
  const { app } = opts;
  if (!app) throw new Error("mountChatTemplatesRoute: app required");

  app.get("/api/system/chat-templates", (_req, res) => {
    res.json({ families: listFamiliesForUi() });
  });

  app.get("/api/system/transports", (_req, res) => {
    res.json({ transports: TRANSPORTS });
  });
}
