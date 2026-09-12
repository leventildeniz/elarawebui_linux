// Auth/identity federated user helper (extracted from server.mjs)
// DI: initAuthSchema({ pool, hashPassword, createPrefixedId, randomBytes }) -> { ensureFederatedUser }

export function initAuthSchema({ pool, hashPassword, createPrefixedId, randomBytes }) {
  async function ensureFederatedUser({ provider, username, role, email, groups }) {
    // 1. Resolve domain from email or username
    const userIdentifier = email || username || "";
    let domainCandidate = "";
    if (userIdentifier.includes("@")) {
      domainCandidate = userIdentifier.split("@")[1]?.toLowerCase().trim() || "";
    }

    // 2. Resolve target tenant_id from app_tenants via domain match or auth_providers match
    let resolvedTenantId = "default";
    try {
      if (domainCandidate) {
        const tMatch = await pool.query(
          `SELECT slug FROM app_tenants 
           WHERE domain ILIKE '%' || $1 || '%' 
              OR $2 = ANY(auth_providers) 
           ORDER BY CASE WHEN slug = 'default' THEN 2 ELSE 1 END 
           LIMIT 1`,
          [domainCandidate, provider]
        );
        if (tMatch.rows.length > 0) {
          resolvedTenantId = tMatch.rows[0].slug;
        }
      } else {
        const tMatch = await pool.query(
          `SELECT slug FROM app_tenants WHERE $1 = ANY(auth_providers) LIMIT 1`,
          [provider]
        );
        if (tMatch.rows.length > 0) {
          resolvedTenantId = tMatch.rows[0].slug;
        }
      }
    } catch {}

    // 3. Resolve role and studio group bindings from directory claims (e.g. AD Domain Admins -> Admin)
    let effectiveRole = role || "Viewer";
    let effectiveGroups = Array.isArray(groups) ? [...groups] : [];
    try {
      if (Array.isArray(groups) && groups.length > 0) {
        const mappedGroups = await pool.query(
          `SELECT id, role FROM app_groups 
           WHERE directory_groups ?| $1::text[] 
              OR approver_directory_groups ?| $1::text[]`,
          [groups]
        );
        for (const mg of mappedGroups.rows) {
          if (!effectiveGroups.includes(mg.id)) effectiveGroups.push(mg.id);
          if (mg.role === "Admin" || mg.role === "admin") effectiveRole = "Admin";
          else if (effectiveRole !== "Admin" && mg.role) effectiveRole = mg.role;
        }
      }
    } catch {}

    const exist = await pool.query(
      "SELECT * FROM app_users WHERE lower(username)=lower($1) AND provider=$2 LIMIT 1",
      [username, provider]
    );
    if (exist.rows[0]) {
      // Refresh role, groups, and tenant on every login so AD/Entra/NPS changes propagate instantly.
      await pool.query(
        "UPDATE app_users SET role=$1, email=COALESCE(NULLIF($2,''), email), groups=$3::jsonb, tenant_id=$4, last_login_at=now() WHERE id=$5",
        [effectiveRole, email || "", JSON.stringify(effectiveGroups), resolvedTenantId, exist.rows[0].id]
      );
      const r = await pool.query("SELECT * FROM app_users WHERE id=$1", [exist.rows[0].id]);
      return r.rows[0];
    }
    // Synthetic password (federated users never log in via local password).
    const { hash, salt } = hashPassword(randomBytes(16).toString("hex"));
    const id = createPrefixedId("u_");
    await pool.query(
      `INSERT INTO app_users(id,username,email,phone,password_hash,password_salt,provider,role,groups,tenant_id,status)
       VALUES ($1,$2,$3,'',$4,$5,$6,$7,$8::jsonb,$9,'active')`,
      [id, username, email || "", hash, salt, provider, effectiveRole, JSON.stringify(effectiveGroups), resolvedTenantId]
    );
    const r = await pool.query("SELECT * FROM app_users WHERE id=$1", [id]);
    return r.rows[0];
  }

  return { ensureFederatedUser };
}
