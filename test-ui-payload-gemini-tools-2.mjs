import fetch from "node-fetch";
const req = {
  model: "mod.gem25fl",
  messages: [{ role: "user", content: "bana istanbul için guncel tarih ve hava durumunu verirmisin?" }],
  capabilities: { tools: ["log.date_time", "tool.weather"], skills: [] }
};
const res = await fetch("http://127.0.0.1:3005/api/chat/orchestrate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(req)
});
console.log(await res.text());
