export async function mountDirectoryRoutes(app, deps) {
  const { isAdminCaller, readProviderConfig } = deps;
  
  app.get("/api/identity/directory/:kind/groups", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { kind } = req.params;
    try {
      const cfgRow = await readProviderConfig(kind);
      if (!cfgRow || !cfgRow.enabled || !cfgRow.config.url) {
        return res.json({ ok: true, data: [] });
      }
      
      const { Client } = await import('ldapts');
      const client = new Client({ url: cfgRow.config.url, timeout: 3000, connectTimeout: 3000 });
      
      const searchBase = cfgRow.config.groupSearchBase || "dc=local";
      const filter = cfgRow.config.groupSearchFilter || "(objectClass=group)";
      
      try {
        if (cfgRow.config.bindDn && cfgRow.config.bindPassword) {
          await client.bind(cfgRow.config.bindDn, cfgRow.config.bindPassword);
        }
        const { searchEntries } = await client.search(searchBase, { filter, scope: 'sub', sizeLimit: 50 });
        const data = searchEntries.map(e => ({
          dn: e.dn,
          name: Array.isArray(e.cn) ? e.cn[0] : (e.cn || e.name || e.dn),
          members: Array.isArray(e.member) ? e.member.length : (e.member ? 1 : 0),
          ou: e.dn.split(",").find(p => p.startsWith("OU=")) || "Group",
          mail: Array.isArray(e.mail) ? e.mail[0] : (e.mail || "")
        }));
        res.json({ ok: true, data });
      } finally {
        await client.unbind().catch(()=>{});
      }
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  app.get("/api/identity/directory/:kind/users", async (req, res) => {
    if (!await isAdminCaller(req)) return res.status(403).json({ ok: false, error: "admin required" });
    const { kind } = req.params;
    try {
      const cfgRow = await readProviderConfig(kind);
      if (!cfgRow || !cfgRow.enabled || !cfgRow.config.url) {
        return res.json({ ok: true, data: [] });
      }
      
      const { Client } = await import('ldapts');
      const client = new Client({ url: cfgRow.config.url, timeout: 3000, connectTimeout: 3000 });
      
      const searchBase = cfgRow.config.userSearchBase || "dc=local";
      const filter = "(objectClass=user)"; // Simple default
      
      try {
        if (cfgRow.config.bindDn && cfgRow.config.bindPassword) {
          await client.bind(cfgRow.config.bindDn, cfgRow.config.bindPassword);
        }
        const { searchEntries } = await client.search(searchBase, { filter, scope: 'sub', sizeLimit: 100 });
        const data = searchEntries.map(e => ({
          dn: e.dn,
          username: Array.isArray(e.uid) ? e.uid[0] : (Array.isArray(e.sAMAccountName) ? e.sAMAccountName[0] : e.dn),
          name: Array.isArray(e.displayName) ? e.displayName[0] : (Array.isArray(e.cn) ? e.cn[0] : e.dn),
          mail: Array.isArray(e.mail) ? e.mail[0] : (e.mail || ""),
          title: Array.isArray(e.title) ? e.title[0] : "",
          memberOf: Array.isArray(e.memberOf) ? e.memberOf : (e.memberOf ? [e.memberOf] : []),
          disabled: false
        }));
        res.json({ ok: true, data });
      } finally {
        await client.unbind().catch(()=>{});
      }
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });
}
