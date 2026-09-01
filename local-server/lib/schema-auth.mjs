// Auth/identity federated user helper (extracted from server.mjs)
// DI: initAuthSchema({ pool, hashPassword, createPrefixedId, randomBytes }) -> { ensureFederatedUser }

export function initAuthSchema({ pool, hashPassword, createPrefixedId, randomBytes }) {
  async function ensureFederatedUser({ provider, username, role, email, groups }) {
    const exist = await pool.query(
      "SELECT * FROM app_users WHERE lower(username)=lower($1) AND provider=$2 LIMIT 1",
      [username, provider]
    );
    if (exist.rows[0]) {
      // Refresh role on every login so AD/NPS group changes propagate.
      await pool.query(
        "UPDATE app_users SET role=$1, email=COALESCE(NULLIF($2,''), email), groups=$3::jsonb, last_login_at=now() WHERE id=$4",
        [role, email || "", JSON.stringify(groups || []), exist.rows[0].id]
      );
      const r = await pool.query("SELECT * FROM app_users WHERE id=$1", [exist.rows[0].id]);
      return r.rows[0];
    }
    // Synthetic password (federated users never log in via local password).
    const { hash, salt } = hashPassword(randomBytes(16).toString("hex"));
    const id = createPrefixedId("u_");
    await pool.query(
      `INSERT INTO app_users(id,username,email,phone,password_hash,password_salt,provider,role,groups,status)
       VALUES ($1,$2,$3,'',$4,$5,$6,$7,$8::jsonb,'active')`,
      [id, username, email || "", hash, salt, provider, role, JSON.stringify(groups || [])]
    );
    const r = await pool.query("SELECT * FROM app_users WHERE id=$1", [id]);
    return r.rows[0];
  }

  return { ensureFederatedUser };
}
