import fetch from "node-fetch";

async function run() {
  const r = await fetch("http://localhost:3005/api/agents");
  const agents = await r.json();
  const id = agents[0].id;
  console.log("Updating agent", id);
  const up = await fetch(, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility: "workspace" })
  });
  console.log("Status:", up.status);
  console.log("Response:", await up.text());
}
run();
