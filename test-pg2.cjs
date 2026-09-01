const pg = require('./local-server/node_modules/pg');
const pool = new pg.Pool({ connectionString: 'postgres://sovereign:sovereign@127.0.0.1:5432/elara_db' });
async function test() {
  const mems = ['00000000-0000-0000-0000-000000000000'];
  const res = await pool.query('SELECT id FROM app_users WHERE id = ANY(::text[])', [mems]);
  console.log(res.rows);
  process.exit(0);
}
test();
