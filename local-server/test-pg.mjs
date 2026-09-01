import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: 'postgres://sovereign:sovereign@127.0.0.1:5432/elara_db' });
async function run() {
  try {
    const res = await pool.query('UPDATE isolation_profiles SET enabled =  WHERE id= RETURNING *', ['iso.test', false]);
    console.log(res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
