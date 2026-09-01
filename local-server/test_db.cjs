const pg = require('pg');
const pool = new pg.Pool({ connectionString: 'postgres://sovereign:sovereign@127.0.0.1:5432/elara_db' });
pool.query(`
SELECT
    COUNT(*) as total_users,
    COUNT(case when locked=false and status='active' then 1 end) as active_users
FROM app_users;
`).then(res => console.log(JSON.stringify(res.rows, null, 2))).catch(console.error).finally(() => pool.end());