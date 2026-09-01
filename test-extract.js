const fs = require('fs');
async function test() {
  const { extractForgeJson } = await import('./local-server/lib/meta-forge/planner.mjs');
  const txt = "Some text \n\nend text";
  console.log(extractForgeJson(txt));
  
  const txt2 = "Some text \n\nend text";
  console.log(extractForgeJson(txt2));
}
test();
