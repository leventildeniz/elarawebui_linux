const fs = require('fs');
let md = fs.readFileSync('.forge/knowledge/context.md', 'utf8');

const rep = "- **WARNING:** Wiring real data caused React 500 crashes (missing hooks, JSX closure mismatches). Do NOT rewrite the UI layout. Map real API data to the mock dbTables UI structure carefully.\n- **Backend Prepared:** The backend API routes for real telemetry are already written and mounted!\n  - : Provides the Server-Sent Events (SSE) stream for OS vitals (CPU, RAM) and Inventory counts via .\n  - : Contains the deep PostgreSQL inspection endpoint .";

md = md.replace(/- \*\*WARNING:\*\* Wiring real data caused React 500 crashes.*/, rep);
fs.writeFileSync('.forge/knowledge/context.md', md);
