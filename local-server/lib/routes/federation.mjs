import * as openid from 'openid-client';

export async function mountFederationRoutes(app, deps) {
  const { pool, createPrefixedId, readProviderConfig, ensureFederatedUser, rowToUser } = deps;

  app.get("/api/auth/federate/:key/login", async (req, res) => {
    try {
      const { key } = req.params;
      const cfgRow = await readProviderConfig(key);
      if (!cfgRow || !cfgRow.enabled) {
        return res.status(400).send("Provider not found or disabled");
      }
      
      const { id, config } = cfgRow;
      const redirectUri = config.redirectUri || "http://127.0.0.1:3005/api/auth/federate/" + key + "/callback";
      
      let issuerUrl = config.issuerUrl;
      if (id === "entra") {
        issuerUrl = "https://login.microsoftonline.com/" + config.tenantId + "/v2.0";
      }
      
      let configOidc;
      try {
         configOidc = await openid.discovery(new URL(issuerUrl), config.clientId, config.clientSecret);
      } catch (e) {
         // Fallback manual construction
         configOidc = new openid.Configuration(
            { issuer: issuerUrl, authorization_endpoint: issuerUrl + "/oauth2/v2.0/authorize", token_endpoint: issuerUrl + "/oauth2/v2.0/token", jwks_uri: issuerUrl + "/discovery/v2.0/keys" },
            config.clientId,
            config.clientSecret
         );
      }

      const state = createPrefixedId("st_");

      // Store state
      await pool.query(
        "INSERT INTO auth_provider_sources (key, provider_id, label, fields) VALUES ($1, 'state', 'state', $2) ON CONFLICT (key) DO NOTHING",
        ["state_" + state, JSON.stringify({ key })]
      );

      const url = openid.buildAuthorizationUrl(configOidc, {
        redirect_uri: redirectUri,
        scope: config.scope || 'openid profile email',
        state,
      });

      res.redirect(url.href);
    } catch (e) {
      res.status(500).send(e.message);
    }
  });

  app.get("/api/auth/federate/:key/callback", async (req, res) => {
    try {
      const { key } = req.params;
      const cfgRow = await readProviderConfig(key);
      if (!cfgRow || !cfgRow.enabled) return res.status(400).send("Provider missing");
      const { id, config } = cfgRow;
      const redirectUri = config.redirectUri || "http://127.0.0.1:3005/api/auth/federate/" + key + "/callback";

      let issuerUrl = config.issuerUrl;
      if (id === "entra") {
        issuerUrl = "https://login.microsoftonline.com/" + config.tenantId + "/v2.0";
      }
      
      let configOidc;
      try {
         configOidc = await openid.discovery(new URL(issuerUrl), config.clientId, config.clientSecret);
      } catch (e) {
         configOidc = new openid.Configuration(
            { issuer: issuerUrl, authorization_endpoint: issuerUrl + "/oauth2/v2.0/authorize", token_endpoint: issuerUrl + "/oauth2/v2.0/token", jwks_uri: issuerUrl + "/discovery/v2.0/keys" },
            config.clientId,
            config.clientSecret
         );
      }

      const currentUrl = new URL(req.protocol + "://" + req.get("host") + req.originalUrl);
      const tokens = await openid.authorizationCodeGrant(configOidc, currentUrl, {
        expectedState: currentUrl.searchParams.get('state'),
      });
      
      const claims = await openid.fetchUserInfo(configOidc, tokens.access_token, tokens.id_token);

      if (currentUrl.searchParams.get('state')) {
        await pool.query("DELETE FROM auth_provider_sources WHERE key=$1", ["state_" + currentUrl.searchParams.get('state')]);
      }

      const username = claims.preferred_username || claims.upn || claims.email || claims.sub;
      const name = claims.name || username;
      const email = claims.email || username;
      const groups = claims.groups || claims.roles || [];

      const u = await ensureFederatedUser({
        provider: key,
        username,
        email,
        role: config.defaultRole || "Viewer",
        groups
      });

      const sid = createPrefixedId("s_");
      const ip = req.ip || req.socket?.remoteAddress || "";
      await pool.query(
        "INSERT INTO app_sessions(id,user_id,username,role,provider,ip,device) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [sid, u.id, u.username, u.role, u.provider, ip.slice(0,64), "Federated Browser"]
      );

      const html = "<html" + "><body" + "><script>localStorage.setItem('sovereign.sessionId', '" + sid + "'); localStorage.setItem('sovereign.user', JSON.stringify(" + JSON.stringify(rowToUser(u)) + ")); sessionStorage.setItem('sovereign.operator', '" + u.username + "'); window.location.href = '/';</script></body" + "></html" + ">";
      res.send(html);
    } catch (e) {
      res.status(500).send("Login failed: " + e.message);
    }
  });
}
