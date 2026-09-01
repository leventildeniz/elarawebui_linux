// local-server/lib/mutation-guard.mjs
// Block R-3 — FAZ2 blanket mutation guard middleware (path-set + env + wiring).
// 2026-05-30 monolit-avı: server.mjs'ten ayrıldı; davranış AYNI.
//
// Sorumluluk: API yazma uçlarına (POST/PUT/PATCH/DELETE /api/*) blanket
// session zorunluluğu. Public path/prefix, loopback-only path, loopback
// agent-run path ve admin-token knowledge path muafiyetleri korunur.
//
// Konfigürasyon ÇAĞIRAN tarafta kalır (path-set'ler server.mjs'te tek mercii);
// burası saf wiring + check sırası.
//
// Kullanım:
//   import { mountMutationGuard } from "./lib/mutation-guard.mjs";
//   mountMutationGuard(app, {
//     enabled: FAZ2_BLANKET_GUARD,
//     sessionGate: requireSession(),
//     methods: FAZ2_MUTATION_METHODS,
//     publicPaths: FAZ2_PUBLIC_MUTATION_PATHS,
//     publicPrefixes: FAZ2_PUBLIC_MUTATION_PREFIXES,
//     loopbackOnlyPaths: FAZ2_LOOPBACK_ONLY_MUTATION_PATHS,
//     adminTokenPaths: FAZ2_ADMIN_TOKEN_MUTATION_PATHS,
//     deps: { isLoopbackReq, hasLoopbackAdminToken, isAdminTokenKnowledgePath, isLoopbackAgentRunPath },
//   });

export function mountMutationGuard(app, {
  enabled = true,
  sessionGate,
  methods,
  publicPaths,
  publicPrefixes,
  loopbackOnlyPaths,
  loopbackOnlyPrefixes = [],
  adminTokenPaths,
  deps,
} = {}) {
  if (!app) throw new Error("[mutation-guard] app gerekli");
  if (!enabled) return;
  if (typeof sessionGate !== "function") throw new Error("[mutation-guard] sessionGate gerekli");
  if (!(methods instanceof Set)) throw new Error("[mutation-guard] methods Set gerekli");
  if (!(publicPaths instanceof Set)) throw new Error("[mutation-guard] publicPaths Set gerekli");
  if (!Array.isArray(publicPrefixes)) throw new Error("[mutation-guard] publicPrefixes[] gerekli");
  if (!(loopbackOnlyPaths instanceof Set)) throw new Error("[mutation-guard] loopbackOnlyPaths Set gerekli");
  if (!Array.isArray(loopbackOnlyPrefixes)) throw new Error("[mutation-guard] loopbackOnlyPrefixes[] gerekli");
  if (!(adminTokenPaths instanceof Set)) throw new Error("[mutation-guard] adminTokenPaths Set gerekli");
  if (!deps) throw new Error("[mutation-guard] deps gerekli");
  const { isLoopbackReq, hasLoopbackAdminToken, isAdminTokenKnowledgePath, isLoopbackAgentRunPath } = deps;
  for (const [k, v] of Object.entries({ isLoopbackReq, hasLoopbackAdminToken, isAdminTokenKnowledgePath, isLoopbackAgentRunPath })) {
    if (typeof v !== "function") throw new Error(`[mutation-guard] deps.${k} fn gerekli`);
  }

  app.use((req, res, next) => {
    if (!methods.has(req.method)) return next();
    if (!req.path.startsWith("/api/")) return next();
    if (publicPaths.has(req.path)) return next();
    if (publicPrefixes.some((p) => req.path.startsWith(p))) return next();
    if (loopbackOnlyPaths.has(req.path) && isLoopbackReq(req)) return next();
    if (loopbackOnlyPrefixes.length && isLoopbackReq(req)
        && loopbackOnlyPrefixes.some((p) => req.path.startsWith(p))) return next();
    if (isLoopbackAgentRunPath(req.path) && isLoopbackReq(req)) return next();
    if (hasLoopbackAdminToken(req)) {
      if (isAdminTokenKnowledgePath(req.path, adminTokenPaths)) return next();
    }
    return sessionGate(req, res, next);
  });
}
