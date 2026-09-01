import fs from 'fs';

let content = fs.readFileSync('local-server/lib/schema-knowledge.mjs', 'utf8');
content = content.replace(/async function ensureKnowledgeChunksTableImpl\(\) \{[\s\S]*?async function ensureKnowledgeFilesTable/m, 
);

content = content.replace(/async function ensureKnowledgeFilesTableImpl\(\) \{[\s\S]*?return \{ ensureKnowledgeFilesTable/m,
);

fs.writeFileSync('local-server/lib/schema-knowledge.mjs', content);
