// PG version compatibility helpers (extracted from server.mjs)
// DI: initPgVersion({ pool, spawnPg }) -> { getPgClientMajor, getPgServerMajor, ensurePgVersionsCompatible }

export function initPgVersion({ pool, spawnPg }) {
  async function getPgClientMajor() {
    try {
      const { stdout } = await spawnPg("pg_dump", ["--version"]);
      const m = String(stdout).match(/(\d+)\./);
      return m ? Number(m[1]) : null;
    } catch { return null; }
  }

  async function getPgServerMajor() {
    try {
      const r = await pool.query("SHOW server_version_num");
      const n = Number(String(r.rows[0]?.server_version_num || "0"));
      return n ? Math.floor(n / 10000) : null;
    } catch { return null; }
  }

  async function ensurePgVersionsCompatible() {
    const [client, server] = await Promise.all([getPgClientMajor(), getPgServerMajor()]);
    if (client && server && client < server) {
      throw new Error(`pg_dump ${client} < server ${server}; refusing to dump (would be silently lossy). Install matching pg client.`);
    }
    return { client, server };
  }

  return { getPgClientMajor, getPgServerMajor, ensurePgVersionsCompatible };
}
