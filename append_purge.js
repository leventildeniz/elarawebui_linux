const fs = require('fs');
let content = fs.readFileSync('local-server/lib/rag/entity-extractor.mjs', 'utf8');
content += ;
fs.writeFileSync('local-server/lib/rag/entity-extractor.mjs', content);
