import pg from 'pg';
const { Pool } = pg;
import { ensureMetaForgeAgent } from './local-server/lib/meta-forge/seed.mjs';

const pool = new Pool({ connectionString: 'postgres://sovereign:sovereign@127.0.0.1:5432/elara_db' });

async function run() {
  await pool.query('DELETE FROM agents WHERE id = ', ['agt.forge_master']);
  await ensureMetaForgeAgent(pool);
  console.log('Fixed DB prompt');
  process.exit(0);
}
run();
