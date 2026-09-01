const fs = require('fs');
let md = fs.readFileSync('.forge/knowledge/context.md', 'utf8');

const s1 = "- **Backend Prepared:** The backend API routes for real telemetry are already written and mounted!\n";
const s2 = "  - local-server/lib/routes/telemetry-stream.mjs: Provides the Server-Sent Events (SSE) stream for OS vitals and Inventory counts via /api/telemetry/stream.\n";
const s3 = "  - local-server/lib/routes/telemetry.mjs: Contains the deep PostgreSQL inspection endpoint /api/telemetry/db-detail.";

md = md.replace('- **WARNING:** Wiring real data caused React 500 crashes (missing hooks, JSX closure mismatches). Do NOT rewrite the UI layout. Map real API data to the mock dbTables UI structure carefully.', '- **WARNING:** Wiring real data caused React 500 crashes (missing hooks, JSX closure mismatches). Do NOT rewrite the UI layout. Map real API data to the mock dbTables UI structure carefully.\n' + s1 + s2 + s3);

fs.writeFileSync('.forge/knowledge/context.md', md);
