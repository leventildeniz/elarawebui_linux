const pg = require('pg');
const pool = new pg.Pool({ connectionString: 'postgres://sovereign:sovereign@127.0.0.1:5432/elara_db' });
pool.query(`
SELECT id::text, name, 'agent' as kind, stats as metrics, model_ref as meta FROM agents
UNION ALL
SELECT id::text, name, 'workflow' as kind, jsonb_build_object('calls', runs, 'success', runs) as metrics, 'workflow' as meta FROM workflows
LIMIT 5;
`).then(res => console.log(JSON.stringify(res.rows, null, 2))).catch(console.error).finally(() => pool.end());