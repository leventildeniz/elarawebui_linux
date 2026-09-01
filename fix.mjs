import fs from 'fs';
const content = fs.readFileSync('./local-server/lib/meta-forge/seed.mjs', 'utf8');
const match = content.match(/const META_FORGE_SYSTEM_PROMPT = ;/);
if (match) {
  let prompt = match[1];
  prompt = prompt.replace(
    /kind=tool     →  is a complete Python 3 script.*/,
    "kind=tool     →  MUST BE A RAW STRING containing a complete Python 3 script, reading JSON from stdin and printing JSON to stdout. DO NOT nest it under an object, DO NOT output a 'parameters' or 'implementation' object, just write the raw Python code directly in the 'source' string field."
  );
  prompt = prompt.replace(/'/g, "''");
  fs.writeFileSync('update_prompt.sql', "UPDATE agents SET system_prompt = '" + prompt + "' WHERE id = 'agt.forge_master';\n");
}
