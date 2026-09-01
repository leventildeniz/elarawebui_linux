const planner = require("./local-server/lib/meta-forge/planner.mjs");
const txt = \json
{
  "intent": "test",
  "plan": {
    "create": [
      { "kind": "tool", "slug": "test", "source": "# test code\nprint(\\"test\\")" }
    ]
  }
}
\\;
async function run() {
  const { extractForgeJson } = await import("./local-server/lib/meta-forge/planner.mjs");
  const extracted = extractForgeJson(txt);
  console.log(extracted);
}
run();
