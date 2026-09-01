fetch("http://localhost:3005/api/skills", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-session-id": "operator" },
  body: JSON.stringify({ id: "sk.test", name: "test_native", type: "native" })
}).then(r=>r.json()).then(console.log);
