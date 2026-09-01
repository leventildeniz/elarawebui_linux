const fs = require('fs');
let content = fs.readFileSync('local-server/lib/rag/entity-extractor.mjs', 'utf8');

// remove duplicate purgeGraphOrphans at the end
let idx = content.lastIndexOf('export async function purgeGraphOrphans(client) {');
if (idx > 0 && content.indexOf('export async function purgeGraphOrphans', idx + 10) === -1) {
    // it means there's a duplicate. Find the FIRST occurrence and remove the SECOND
    let first = content.indexOf('export async function purgeGraphOrphans(client) {');
    if (first !== idx) {
        content = content.substring(0, idx);
    }
}
fs.writeFileSync('local-server/lib/rag/entity-extractor.mjs', content);
