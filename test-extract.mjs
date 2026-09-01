import { extractForgeJson } from "./local-server/lib/meta-forge/planner.mjs";

const text = \json
{
  "intent": "I will create a tool for you",
  "create": [
    {
      "type": "tool",
      "slug": "my-tool",
      "description": "test"
    }
  ]
}
\\;

console.log(extractForgeJson(text));
