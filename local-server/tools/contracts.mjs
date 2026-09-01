// Faz 9 — Contract fixtures. Frontend ↔ bridge sözleşmelerinin sessiz
// kırılmasını engeller. Her endpoint için cevabın olması gereken kabuğunu
// "must-have key seti" + opsiyonel tip kontrolü ile sabitler.
//
// Bu dosya sadece veri tanımıdır; runner için bkz. tools/smoke.mjs.

export const contracts = [
  {
    name: "health",
    method: "GET",
    path: "/health",
    expectStatus: [200, 503],
    must: ["ok"],
  },
  {
    name: "health.deep",
    method: "GET",
    path: "/health/deep",
    expectStatus: [200, 503],
    must: ["ok", "ts", "subsystems", "failed"],
    subKeys: {
      // Faz 16.3 — tls_proxy artık zorunlu (loopback ulaşılamasa bile probe çıkar).
      subsystems: ["db", "db_schema", "mlx_queue", "auth", "cve", "redaction", "tls_proxy"],
    },
  },
  {
    name: "capabilities.list",
    method: "GET",
    path: "/api/capabilities",
    requiresSession: true,
    expectStatus: [200],
    must: ["capabilities"],
  },
  {
    name: "dispatch.dry_run.explicit",
    method: "POST",
    path: "/api/dispatch/dry-run",
    requiresSession: true,
    body: { text: "!ping" },
    expectStatus: [200],
    must: ["decision"],
    expect: (b) => {
      const d = b.decision;
      if (!d || typeof d !== "object") return "decision missing";
      if (!["explicit", "vector", "llm-router"].includes(d.source)) return `bad source ${d.source}`;
      if (!d.intent || typeof d.intent.kind !== "string") return "intent.kind missing";
      return true;
    },
  },
  {
    name: "dispatch.dry_run.fallback",
    method: "POST",
    path: "/api/dispatch/dry-run",
    requiresSession: true,
    body: { text: "merhaba bu sadece serbest sohbet" },
    expectStatus: [200],
    expect: (b) => (b?.decision?.source ? true : "no decision.source"),
  },
  {
    name: "mlx_queue.stats",
    method: "GET",
    path: "/api/mlx-queue/stats",
    requiresSession: true,
    expectStatus: [200],
    must: ["ok", "stats"],
  },
  {
    name: "vault.list",
    method: "GET",
    path: "/api/vault",
    requiresSession: true,
    requiresAdmin: true,
    expectStatus: [200],
    must: ["items"],
  },
  {
    name: "vault.deny_anonymous",
    method: "POST",
    path: "/api/vault",
    body: { scope: "smoke", name: "x", value: "y" },
    skipSession: true,
    expectStatus: [401, 403],
  },
  {
    // Faz 11.1 — anonim DELETE de gate'in arkasında olmalı.
    name: "vault.deny_anonymous_delete",
    method: "DELETE",
    path: "/api/vault/smoke/x",
    skipSession: true,
    expectStatus: [401, 403],
  },
  {
    // Faz 11.1 — anonim list okuması admin-only.
    name: "vault.deny_anonymous_list",
    method: "GET",
    path: "/api/vault",
    skipSession: true,
    expectStatus: [401, 403],
  },
  {
    // Faz 11.1 — hash zinciri sağlamlığı. Trigger kuruluysa ok:true.
    name: "vault.audit_chain_verify",
    method: "GET",
    path: "/api/vault-audit/verify?limit=2000",
    requiresSession: true,
    requiresAdmin: true,
    expectStatus: [200],
    must: ["ok", "scanned"],
    expect: (b) => b.ok === true || `chain broken at id=${b.broken_at_id} (${b.reason})`,
  },
  {
    name: "cve.list",
    method: "GET",
    path: "/api/cve?limit=1",
    requiresSession: true,
    expectStatus: [200],
    must: ["items"],
  },
  {
    name: "risk.url_isolate",
    method: "POST",
    path: "/api/risk/url",
    requiresSession: true,
    body: { url: "http://random.example.tld/file.exe" },
    expectStatus: [200],
    must: ["decision", "reasons"],
    expect: (b) => ["isolate", "block"].includes(b.decision) || `unexpected decision ${b.decision}`,
  },
  {
    name: "risk.url_ssrf_block",
    method: "POST",
    path: "/api/risk/url",
    requiresSession: true,
    body: { url: "http://127.0.0.1/admin" },
    expectStatus: [200],
    expect: (b) => b.decision === "block" || `expected block got ${b.decision}`,
  },
  {
    name: "workflow.run_missing",
    method: "POST",
    path: "/api/workflow-chains/__nonexistent__/run",
    requiresSession: true,
    // Faz 14.2: chain id validator + existence check → 404 (artık 500 değil).
    expectStatus: [404],
    must: ["error", "code"],
    expect: (b) => b.code === "not_found" || `expected code:not_found got ${b.code}`,
  },

  // ============================================================
  // Faz 13.2 — Sandbox eskalasyon / negative-test matrisi.
  // Her admin-only veya session-gated endpoint için: anonim çağrı →
  // 401/403. 200/5xx = zafiyet sinyali (gate sızması / uncaught crash).
  // ============================================================
  {
    name: "tool.invoke.deny_anonymous",
    method: "POST",
    path: "/api/tools/echo/invoke",
    body: { input: {} },
    skipSession: true,
    expectStatus: [401, 403],
  },
  {
    name: "capabilities.sync.deny_anonymous",
    method: "POST",
    path: "/api/capabilities/sync",
    skipSession: true,
    expectStatus: [401, 403],
  },
  {
    name: "tool_approvals.pending.deny_anonymous",
    method: "GET",
    path: "/api/tool-approvals/pending",
    skipSession: true,
    expectStatus: [401, 403],
  },
  {
    name: "tool_approvals.decide.deny_anonymous",
    method: "POST",
    path: "/api/tool-approvals/fake-invocation-id/decide",
    body: { approve: true },
    skipSession: true,
    expectStatus: [401, 403],
  },
  {
    name: "vault_audit.verify.deny_anonymous",
    method: "GET",
    path: "/api/vault-audit/verify?limit=10",
    skipSession: true,
    expectStatus: [401, 403],
  },
  {
    name: "vault_audit.rebuild.deny_anonymous",
    method: "POST",
    path: "/api/vault-audit/rebuild",
    skipSession: true,
    expectStatus: [401, 403],
  },
  {
    name: "vault_audit.list.deny_anonymous",
    method: "GET",
    path: "/api/vault-audit?limit=10",
    skipSession: true,
    expectStatus: [401, 403],
  },
  {
    // Path traversal in tool id — route param escape attempt.
    // Hedef: 400/401/403/404 — kesinlikle 200 ya da 500 değil.
    name: "tool.invoke.path_traversal",
    method: "POST",
    path: "/api/tools/..%2F..%2Fetc%2Fpasswd/invoke",
    requiresSession: true,
    body: { input: {} },
    expectStatus: [400, 401, 403, 404],
  },
  {
    // Faz 14.2: artık 400 (regex valid değil, encoded slash içeriyor).
    name: "workflow.run.path_traversal",
    method: "POST",
    path: "/api/workflow-chains/..%2F..%2Fadmin/run",
    requiresSession: true,
    expectStatus: [400, 404],
    expect: (b) => ["bad_request", "not_found"].includes(b?.code) || `expected bad_request|not_found got ${b?.code}`,
  },
  {
    name: "vault.list.bogus_session",
    method: "GET",
    path: "/api/vault",
    skipSession: true,
    headers: { cookie: "elara_session=deadbeefdeadbeefdeadbeefdeadbeef" },
    expectStatus: [401, 403],
  },
  {
    // Faz 14.3: oversize artık 413 (1mb hard limit) — 200 kabul edilmez.
    name: "vault.write.oversize_rejected",
    method: "POST",
    path: "/api/vault",
    requiresSession: true,
    requiresAdmin: true,
    body: { scope: "smoke", name: "oversize", value: "A".repeat(2_000_000) },
    expectStatus: [400, 413, 422],
  },
  {
    // Faz 14.3 — Capability/ACL: var olmayan tool id, admin oturumla bile
    // 404 + code:not_found dönmeli (uncaught 500 değil, sessiz 200 değil).
    name: "tool.invoke.unknown_id_not_found",
    method: "POST",
    path: "/api/tools/__definitely_not_a_real_tool__/invoke",
    requiresSession: true,
    requiresAdmin: true,
    body: { params: {} },
    expectStatus: [404, 403],
    expect: (b) => ["not_found", "acl"].includes(b?.code) || `expected code:not_found|acl got ${b?.code}`,
  },
  {
    // Faz 14.4 — SIEM forwarder status endpoint. Outbox/dead/queue metrikleri
    // expose edilmiş olmalı (chaos drill ve dashboard için).
    name: "siem.config_status",
    method: "GET",
    path: "/api/siem/config",
    requiresSession: true,
    requiresAdmin: true,
    expectStatus: [200],
    must: ["ok", "status"],
    expect: (b) => {
      const s = b.status;
      if (!s) return "status missing";
      for (const k of ["queueDepth", "outboxDepth", "dropped", "sent", "dead"]) {
        if (!(k in s)) return `status.${k} missing`;
      }
      return true;
    },
  },
  {
    // Faz 16.3 — dev-tls-proxy stats endpoint health/deep içinden raporlanmalı.
    // HTTP 3005 üzerinden bakıldığında "reachable" true bekleniyor (loopback aynı host).
    name: "tls_proxy.observable",
    method: "GET",
    path: "/health/deep",
    expectStatus: [200, 503],
    expect: (b) => {
      const t = b?.subsystems?.tls_proxy;
      if (!t) return "tls_proxy probe missing";
      if (!("info" in t) && !("error" in t)) return "tls_proxy info/error missing";
      // Sadece "configured" alanı şart — reachable env'e bağlı.
      const info = t.info || {};
      if (!("configured" in info)) return "tls_proxy.configured missing";
      return true;
    },
  },

  // ============================================================
  // Faz 19 — Agent / Tool / Workflow / Orchestration pozitif testler.
  // agent-stack-smoke.sh tarafından --only ile çağrılır.
  // ============================================================
  {
    name: "agent.capabilities.has_entries",
    method: "GET",
    path: "/api/capabilities",
    requiresSession: true,
    expectStatus: [200],
    must: ["capabilities"],
    expect: (b) => {
      if (!Array.isArray(b.capabilities)) return "capabilities not array";
      if (b.capabilities.length === 0) return "capability registry empty — sync needed?";
      return true;
    },
  },
  {
    name: "agent.dispatch.happy_path_explicit",
    method: "POST",
    path: "/api/dispatch/dry-run",
    requiresSession: true,
    body: { text: "!ping" },
    expectStatus: [200],
    must: ["ok", "decision"],
    expect: (b) => {
      const d = b.decision;
      if (d?.source !== "explicit") return `expected explicit source, got ${d?.source}`;
      if (!d?.intent?.kind) return "intent.kind missing in explicit dispatch";
      return true;
    },
  },
  {
    name: "agent.workflows.list",
    method: "GET",
    path: "/api/workflows",
    requiresSession: true,
    expectStatus: [200],
    expect: (b) => {
      // /api/workflows farklı şekiller dönebilir: {ok, workflows:[]} veya direkt array.
      if (Array.isArray(b)) return true;
      if (Array.isArray(b?.workflows)) return true;
      if (Array.isArray(b?.items)) return true;
      return "workflows list shape unexpected";
    },
  },
  {
    name: "agent.orchestration.runs_list",
    method: "GET",
    path: "/api/runs?limit=5",
    requiresSession: true,
    expectStatus: [200],
    must: ["ok", "runs"],
    expect: (b) => Array.isArray(b.runs) || "runs not array",
  },
];
