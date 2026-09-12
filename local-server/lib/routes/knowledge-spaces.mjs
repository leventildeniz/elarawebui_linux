export async function mountKnowledgeSpacesRoutes(app, deps) {
  const { pool, isAdminCaller, createPrefixedId, resolveActorContext } = deps;

  app.get("/api/knowledge/spaces", async (req, res) => {
    try {
      const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
      let query = "SELECT * FROM knowledge_spaces";
      const params = [];
      if (!ctx.isSuperAdmin) {
        query += " WHERE (tenant_id = $1 OR is_global = true OR tenant_id = 'default')";
        params.push(ctx.tenantId || "default");
      }
      query += " ORDER BY created_at ASC";

      const { rows } = await pool.query(query, params);
      res.json(rows.map(s => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        description: s.description || "",
        tone: s.tone || "sapphire",
        tenant_id: s.tenant_id || "default",
        is_global: !!s.is_global,
        readerGroups: Array.isArray(s.reader_groups) ? s.reader_groups : [],
        readerUsers: Array.isArray(s.reader_users) ? s.reader_users : [],
        contributorGroups: Array.isArray(s.contributor_groups) ? s.contributor_groups : [],
        contributorUsers: Array.isArray(s.contributor_users) ? s.contributor_users : [],
        allowedTypes: Array.isArray(s.allowed_types) ? s.allowed_types : [],
        maxMb: s.max_mb || 50
      })));
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.post("/api/knowledge/spaces", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
    const id = req.body.id || createPrefixedId("spc.");
    const s = req.body;
    const tenantId = s.tenant_id || (ctx.isSuperAdmin ? (s.tenant_id || "default") : ctx.tenantId);

    try {
      await pool.query(
        `INSERT INTO knowledge_spaces (id, name, slug, description, tone, tenant_id, is_global, reader_groups, reader_users, contributor_groups, contributor_users, allowed_types, max_mb)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13)`,
        [
          id, s.name || "New Space", s.slug || id, s.description || "", s.tone || "sapphire",
          tenantId, ctx.isSuperAdmin ? (s.is_global || false) : false,
          JSON.stringify(s.readerGroups || []), JSON.stringify(s.readerUsers || []),
          JSON.stringify(s.contributorGroups || []), JSON.stringify(s.contributorUsers || []),
          JSON.stringify(s.allowedTypes || []), s.maxMb || 50
        ]
      );
      
      // Update ACL
      await syncAcl(id, s);

      res.status(201).json({ ok: true, id });
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  app.put("/api/knowledge/spaces/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
    const id = req.params.id;
    const s = req.body;

    if (!ctx.isSuperAdmin) {
      const chk = await pool.query("SELECT tenant_id FROM knowledge_spaces WHERE id = $1", [id]);
      if (!chk.rows.length || (chk.rows[0].tenant_id !== ctx.tenantId && chk.rows[0].tenant_id !== "default")) {
        return res.status(403).json({ ok: false, error: "Access denied to knowledge space outside your organization" });
      }
    }

    const updates = [];
    const values = [];
    let i = 1;

    if (s.name !== undefined) { updates.push(`name=$${i++}`); values.push(s.name); }
    if (s.slug !== undefined) { updates.push(`slug=$${i++}`); values.push(s.slug); }
    if (s.description !== undefined) { updates.push(`description=$${i++}`); values.push(s.description); }
    if (s.tone !== undefined) { updates.push(`tone=$${i++}`); values.push(s.tone); }
    if (s.readerGroups !== undefined) { updates.push(`reader_groups=$${i++}::jsonb`); values.push(JSON.stringify(s.readerGroups)); }
    if (s.readerUsers !== undefined) { updates.push(`reader_users=$${i++}::jsonb`); values.push(JSON.stringify(s.readerUsers)); }
    if (s.contributorGroups !== undefined) { updates.push(`contributor_groups=$${i++}::jsonb`); values.push(JSON.stringify(s.contributorGroups)); }
    if (s.contributorUsers !== undefined) { updates.push(`contributor_users=$${i++}::jsonb`); values.push(JSON.stringify(s.contributorUsers)); }
    if (s.allowedTypes !== undefined) { updates.push(`allowed_types=$${i++}::jsonb`); values.push(JSON.stringify(s.allowedTypes)); }
    if (s.maxMb !== undefined) { updates.push(`max_mb=$${i++}`); values.push(s.maxMb); }

    if (updates.length > 0) {
      values.push(id);
      try {
        await pool.query(`UPDATE knowledge_spaces SET ${updates.join(", ")} WHERE id=$${i}`, values);
        
        // Refresh full object to sync ACL
        const { rows } = await pool.query("SELECT * FROM knowledge_spaces WHERE id=$1", [id]);
        if (rows[0]) {
          const r = rows[0];
          await syncAcl(id, {
            readerGroups: r.reader_groups,
            readerUsers: r.reader_users,
            contributorGroups: r.contributor_groups,
            contributorUsers: r.contributor_users
          });
        }
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
    } else {
      res.json({ ok: true });
    }
  });

  app.delete("/api/knowledge/spaces/:id", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const ctx = typeof resolveActorContext === "function" ? await resolveActorContext(req) : { isSuperAdmin: true, tenantId: "default" };
    const id = req.params.id;
    try {
      if (!ctx.isSuperAdmin) {
        const chk = await pool.query("SELECT tenant_id FROM knowledge_spaces WHERE id = $1", [id]);
        if (!chk.rows.length || chk.rows[0].tenant_id !== ctx.tenantId) {
          return res.status(403).json({ ok: false, error: "Access denied to knowledge space outside your organization" });
        }
      }
      await pool.query("DELETE FROM knowledge_spaces WHERE id=$1", [id]);
      res.status(204).end();
    } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });

  // Helper for ACL syncing
  async function syncAcl(spaceId, s) {
    await pool.query("DELETE FROM knowledge_space_acl WHERE space_id=$1", [spaceId]);
    
    const inserts = [];
    
    const add = (arr, access, kind) => {
      if (Array.isArray(arr)) {
        for (const principal of arr) {
          inserts.push({ spaceId, principal, kind, access });
        }
      }
    };
    
    add(s.readerGroups, 'read', 'group');
    add(s.readerUsers, 'read', 'user');
    add(s.contributorGroups, 'write', 'group');
    add(s.contributorUsers, 'write', 'user');

    for (const i of inserts) {
      if (i.principal === '*') i.kind = 'any';
    }

    if (inserts.length > 0) {
      for (const i of inserts) {
         await pool.query(
           "INSERT INTO knowledge_space_acl (space_id, principal, principal_kind, access) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
           [i.spaceId, i.principal, i.kind, i.access]
         );
      }
    }
  }
}