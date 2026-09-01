import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgres://sovereign:sovereign@127.0.0.1:5432/elara_db' });
async function run() {
  try {
    const res = await pool.query("SELECT id FROM isolation_profiles WHERE id='iso.01'");
    console.log("Check before:", res.rows);
  } finally { pool.end(); }
}
run();
