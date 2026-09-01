const pg = require('pg');
const pool = new pg.Pool({ connectionString: 'postgres://sovereign:sovereign@127.0.0.1:5432/elara_db' });
pool.query(`
SELECT
    relname as table_name,
    n_dead_tup,
    n_live_tup
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
`).then(res => console.log(JSON.stringify(res.rows, null, 2))).catch(console.error).finally(() => pool.end());