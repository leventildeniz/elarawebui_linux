// lib/routes/reporting.mjs — Enterprise Reporting & Analytics Engine for ELARA Sovereign Studio
// Provides cross-workspace rollups, usage metrics, FinOps cost ledgers, operator analytics,
// RAG telemetry, and scheduled report delivery persistence in PostgreSQL.

export async function mountReportingRoutes(app, deps) {
  const { pool, resolveActorContext, buildVisibility } = deps;

  // Initialize supporting tables idempotently
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedules (
        id           text PRIMARY KEY,
        name         text NOT NULL,
        template_id  text,
        period       text,
        range_from   text,
        range_to     text,
        top_n        integer,
        sort_by      text,
        user_id      text,
        format       text,
        delivery     text,
        recipients   text,
        destination  text,
        cadence      text,
        run_time     text,
        weekday      integer,
        day_of_month integer,
        enabled      boolean NOT NULL DEFAULT false,
        next_run     timestamptz,
        last_run     timestamptz,
        status       text NOT NULL DEFAULT 'idle',
        owner_id     text,
        owner_name   text,
        visibility   text NOT NULL DEFAULT 'private',
        shared_with  jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
    `);
  } catch (err) {
    console.warn("[Reporting API] Notice creating schedules table:", err.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schedule_deliveries (
        id          text PRIMARY KEY,
        schedule_id text REFERENCES schedules(id) ON DELETE CASCADE,
        name        text,
        at          timestamptz NOT NULL DEFAULT now(),
        channel     text,
        format      text,
        target      text,
        outcome     text,
        detail      text
      );
    `);
  } catch (err) {
    console.warn("[Reporting API] Notice creating schedule_deliveries table:", err.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rag_queries (
        id           text PRIMARY KEY,
        at           timestamptz NOT NULL DEFAULT now(),
        query        text NOT NULL,
        principal    text,
        principal_id text,
        agent        text,
        spaces       jsonb NOT NULL DEFAULT '[]'::jsonb,
        blocked      integer NOT NULL DEFAULT 0,
        docs         integer NOT NULL DEFAULT 0,
        chunks       integer NOT NULL DEFAULT 0,
        hit          boolean NOT NULL DEFAULT false
      );
    `);
  } catch (err) {
    console.warn("[Reporting API] Notice creating rag_queries table:", err.message);
  }

  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_queries_at ON rag_queries(at DESC);
      CREATE INDEX IF NOT EXISTS idx_schedules_owner ON schedules(owner_id);
    `);
  } catch (err) {
    console.warn("[Reporting API] Notice creating indices:", err.message);
  }

  // Helper to parse date window from query parameters
  function parseDateRange(reqQuery) {
    const DAY_MS = 86_400_000;
    const now = new Date();
    const todayEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS - 1;

    let days = 30;
    let label = "Last 30 days";
    let slug = "30d";
    let startMs = todayEnd - 30 * DAY_MS;
    let endMs = todayEnd;

    if (reqQuery.from && reqQuery.to) {
      const pFrom = Date.parse(`${reqQuery.from}T00:00:00Z`);
      const pTo = Date.parse(`${reqQuery.to}T23:59:59Z`);
      if (!Number.isNaN(pFrom) && !Number.isNaN(pTo) && pTo >= pFrom) {
        startMs = pFrom;
        endMs = pTo;
        days = Math.max(1, Math.round((pTo - pFrom) / DAY_MS));
        label = `${reqQuery.from} → ${reqQuery.to}`;
        slug = `${reqQuery.from}_${reqQuery.to}`;
      }
    } else if (reqQuery.span === "7d") {
      days = 7;
      startMs = todayEnd - 7 * DAY_MS;
      label = "Last 7 days";
      slug = "7d";
    } else if (reqQuery.span === "90d") {
      days = 90;
      startMs = todayEnd - 90 * DAY_MS;
      label = "Last 90 days";
      slug = "90d";
    }

    return {
      days,
      startMs,
      endMs,
      startDate: new Date(startMs).toISOString(),
      endDate: new Date(endMs).toISOString(),
      label,
      slug,
    };
  }

  // =========================================================================
  // 1. GET /api/reporting/overview
  // =========================================================================
  app.get("/api/reporting/overview", async (req, res) => {
    try {
      const { days, startDate, endDate, label, slug } = parseDateRange(req.query);

      // 1. Aggregate usage totals from provider_usage
      const usageRes = await pool.query(
        `SELECT 
           COALESCE(COUNT(*), 0)::bigint as total_runs,
           COALESCE(SUM(prompt_tokens + response_tokens), 0)::bigint as total_tokens,
           COALESCE(SUM(cost_usd), 0)::numeric as total_cost,
           COALESCE(COUNT(CASE WHEN status != 'ok' THEN 1 END), 0)::bigint as total_errors,
           COALESCE(AVG(latency_ms), 0)::int as avg_latency
         FROM provider_usage
         WHERE created_at >= $1 AND created_at <= $2`,
        [startDate, endDate]
      );

      const uRow = usageRes.rows[0];
      const runs = Number(uRow.total_runs || 0);
      const tokens = Number(uRow.total_tokens || 0);
      const cost = Number(Number(uRow.total_cost || 0).toFixed(2));
      const errors = Number(uRow.total_errors || 0);
      const latency = Number(uRow.avg_latency || 0);
      const successRate = runs > 0 ? Number((100 - (errors / runs) * 100).toFixed(2)) : 100;

      const totals = { runs, tokens, cost, errors, latency, successRate };

      // 2. Daily breakdown trend
      const dailyRes = await pool.query(
        `SELECT 
           TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as day,
           COUNT(*)::bigint as runs,
           COALESCE(SUM(prompt_tokens + response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(cost_usd), 0)::numeric as cost,
           COUNT(CASE WHEN status != 'ok' THEN 1 END)::bigint as errors,
           COALESCE(AVG(latency_ms), 0)::int as latency
         FROM provider_usage
         WHERE created_at >= $1 AND created_at <= $2
         GROUP BY DATE_TRUNC('day', created_at)
         ORDER BY day ASC`,
        [startDate, endDate]
      );

      const dailyMap = new Map();
      for (const r of dailyRes.rows) {
        dailyMap.set(r.day, {
          day: r.day,
          runs: Number(r.runs),
          tokens: Number(r.tokens),
          cost: Number(Number(r.cost).toFixed(2)),
          errors: Number(r.errors),
          latency: Number(r.latency),
        });
      }

      // Fill in any missing calendar days in the window
      const rows = [];
      const DAY_MS = 86_400_000;
      const startDayTime = new Date(startDate).getTime();
      for (let i = 0; i < days; i++) {
        const dStr = new Date(startDayTime + i * DAY_MS).toISOString().slice(0, 10);
        if (dailyMap.has(dStr)) {
          rows.push(dailyMap.get(dStr));
        } else {
          rows.push({
            day: dStr,
            runs: 0,
            tokens: 0,
            cost: 0,
            errors: 0,
            latency: 0,
          });
        }
      }

      // 3. Provider breakdown
      const providerRes = await pool.query(
        `SELECT 
           COALESCE(NULLIF(p.name, ''), COALESCE(NULLIF(u.provider_name, ''), 'Local sovereign runtime')) as label,
           COUNT(u.id)::bigint as runs,
           COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(u.cost_usd), 0)::numeric as cost
         FROM provider_usage u
         LEFT JOIN ai_providers p ON u.provider_id = p.id
         WHERE u.created_at >= $1 AND u.created_at <= $2
         GROUP BY 1
         ORDER BY tokens DESC`,
        [startDate, endDate]
      );

      let providers = providerRes.rows.map((p) => ({
        label: p.label,
        runs: Number(p.runs),
        tokens: Number(p.tokens),
        cost: Number(Number(p.cost).toFixed(2)),
        share: tokens > 0 ? Number(((Number(p.tokens) / tokens) * 100).toFixed(1)) : 0,
      }));

      if (!providers.length) {
        providers = [
          { label: "Local sovereign runtime", runs: 0, tokens: 0, cost: 0, share: 100 },
        ];
      }

      // 4. Squad breakdown (from agents squad and app_groups)
      const squadRes = await pool.query(
        `SELECT 
           COALESCE(NULLIF(a.squad, ''), 'Platform engineering') as label,
           COUNT(u.id)::bigint as runs,
           COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(u.cost_usd), 0)::numeric as cost
         FROM provider_usage u
         LEFT JOIN chat_threads ct ON u.thread_id = ct.id
         LEFT JOIN agents a ON ct.agent_id = a.id
         WHERE u.created_at >= $1 AND u.created_at <= $2
         GROUP BY 1
         ORDER BY runs DESC`,
        [startDate, endDate]
      );

      let squads = squadRes.rows.map((s) => ({
        label: s.label,
        runs: Number(s.runs),
        tokens: Number(s.tokens),
        cost: Number(Number(s.cost).toFixed(2)),
        share: runs > 0 ? Number(((Number(s.runs) / runs) * 100).toFixed(1)) : 0,
      }));

      if (!squads.length) {
        squads = [
          { label: "Platform engineering", runs: 0, tokens: 0, cost: 0, share: 100 },
        ];
      }

      res.json({
        span: { label, slug, days },
        totals,
        rows,
        squads,
        providers,
      });
    } catch (err) {
      console.error("[Reporting API] Error in /api/reporting/overview:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  // =========================================================================
  // 2. GET /api/reporting/usage
  // =========================================================================
  app.get("/api/reporting/usage", async (req, res) => {
    try {
      const { days, startDate, endDate, label, slug } = parseDateRange(req.query);

      // Usage aggregate
      const usageRes = await pool.query(
        `SELECT 
           COALESCE(COUNT(*), 0)::bigint as total_runs,
           COALESCE(SUM(prompt_tokens + response_tokens), 0)::bigint as total_tokens,
           COALESCE(SUM(cost_usd), 0)::numeric as total_cost,
           COALESCE(COUNT(CASE WHEN status != 'ok' THEN 1 END), 0)::bigint as total_errors,
           COALESCE(AVG(latency_ms), 0)::int as avg_latency
         FROM provider_usage
         WHERE created_at >= $1 AND created_at <= $2`,
        [startDate, endDate]
      );

      const uRow = usageRes.rows[0];
      const runs = Number(uRow.total_runs || 0);
      const tokens = Number(uRow.total_tokens || 0);
      const cost = Number(Number(uRow.total_cost || 0).toFixed(2));
      const errors = Number(uRow.total_errors || 0);
      const latency = Number(uRow.avg_latency || 0);
      const successRate = runs > 0 ? Number((100 - (errors / runs) * 100).toFixed(2)) : 100;

      const totals = { runs, tokens, cost, errors, latency, successRate };

      // Daily trend
      const dailyRes = await pool.query(
        `SELECT 
           TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as day,
           COUNT(*)::bigint as runs,
           COALESCE(SUM(prompt_tokens + response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(cost_usd), 0)::numeric as cost,
           COUNT(CASE WHEN status != 'ok' THEN 1 END)::bigint as errors,
           COALESCE(AVG(latency_ms), 0)::int as latency
         FROM provider_usage
         WHERE created_at >= $1 AND created_at <= $2
         GROUP BY DATE_TRUNC('day', created_at)
         ORDER BY day ASC`,
        [startDate, endDate]
      );

      const dailyMap = new Map();
      for (const r of dailyRes.rows) {
        dailyMap.set(r.day, {
          day: r.day,
          runs: Number(r.runs),
          tokens: Number(r.tokens),
          cost: Number(Number(r.cost).toFixed(2)),
          errors: Number(r.errors),
          latency: Number(r.latency),
        });
      }

      const rows = [];
      const DAY_MS = 86_400_000;
      const startDayTime = new Date(startDate).getTime();
      for (let i = 0; i < days; i++) {
        const dStr = new Date(startDayTime + i * DAY_MS).toISOString().slice(0, 10);
        if (dailyMap.has(dStr)) {
          rows.push(dailyMap.get(dStr));
        } else {
          rows.push({ day: dStr, runs: 0, tokens: 0, cost: 0, errors: 0, latency: 0 });
        }
      }

      // Peak day calculation
      const peak = rows.reduce(
        (acc, curr) => (curr.runs > acc.runs ? curr : acc),
        rows[0] || { day: "—", runs: 0, tokens: 0, cost: 0, errors: 0, latency: 0 }
      );

      // Workload breakdown (by kind in provider_usage + workflow_runs)
      const workloadRes = await pool.query(
        `SELECT 
           CASE 
             WHEN u.kind = 'workflow' THEN 'Workflow runs'
             WHEN u.kind = 'rag' THEN 'RAG retrieval'
             WHEN u.kind = 'tool' THEN 'Tool / MCP calls'
             WHEN u.kind = 'vlm' OR u.kind = 'tts' THEN 'Vision & Voice'
             ELSE 'Chat orchestration'
           END as label,
           COUNT(u.id)::bigint as runs,
           COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(u.cost_usd), 0)::numeric as cost
         FROM provider_usage u
         WHERE u.created_at >= $1 AND u.created_at <= $2
         GROUP BY 1
         ORDER BY tokens DESC`,
        [startDate, endDate]
      );

      let workloads = workloadRes.rows.map((w) => ({
        label: w.label,
        runs: Number(w.runs),
        tokens: Number(w.tokens),
        cost: Number(Number(w.cost).toFixed(2)),
        share: tokens > 0 ? Number(((Number(w.tokens) / tokens) * 100).toFixed(1)) : 0,
      }));

      if (!workloads.length) {
        workloads = [
          { label: "Chat orchestration", runs: 0, tokens: 0, cost: 0, share: 100 },
        ];
      }

      // Provider usage
      const providerRes = await pool.query(
        `SELECT 
           COALESCE(NULLIF(p.name, ''), COALESCE(NULLIF(u.provider_name, ''), 'Local sovereign runtime')) as label,
           COUNT(u.id)::bigint as runs,
           COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(u.cost_usd), 0)::numeric as cost
         FROM provider_usage u
         LEFT JOIN ai_providers p ON u.provider_id = p.id
         WHERE u.created_at >= $1 AND u.created_at <= $2
         GROUP BY 1
         ORDER BY tokens DESC`,
        [startDate, endDate]
      );

      let providers = providerRes.rows.map((p) => ({
        label: p.label,
        runs: Number(p.runs),
        tokens: Number(p.tokens),
        cost: Number(Number(p.cost).toFixed(2)),
        share: tokens > 0 ? Number(((Number(p.tokens) / tokens) * 100).toFixed(1)) : 0,
      }));

      if (!providers.length) {
        providers = [
          { label: "Local sovereign runtime", runs: 0, tokens: 0, cost: 0, share: 100 },
        ];
      }

      // Squad usage
      const squadRes = await pool.query(
        `SELECT 
           COALESCE(NULLIF(a.squad, ''), 'Platform engineering') as label,
           COUNT(u.id)::bigint as runs,
           COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(u.cost_usd), 0)::numeric as cost
         FROM provider_usage u
         LEFT JOIN chat_threads ct ON u.thread_id = ct.id
         LEFT JOIN agents a ON ct.agent_id = a.id
         WHERE u.created_at >= $1 AND u.created_at <= $2
         GROUP BY 1
         ORDER BY runs DESC`,
        [startDate, endDate]
      );

      let squads = squadRes.rows.map((s) => ({
        label: s.label,
        runs: Number(s.runs),
        tokens: Number(s.tokens),
        cost: Number(Number(s.cost).toFixed(2)),
        share: runs > 0 ? Number(((Number(s.runs) / runs) * 100).toFixed(1)) : 0,
      }));

      if (!squads.length) {
        squads = [
          { label: "Platform engineering", runs: 0, tokens: 0, cost: 0, share: 100 },
        ];
      }

      res.json({
        span: { label, slug, days },
        totals,
        peak,
        rows,
        workloads,
        providers,
        squads,
      });
    } catch (err) {
      console.error("[Reporting API] Error in /api/reporting/usage:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  // =========================================================================
  // 3. GET /api/reporting/cost
  // =========================================================================
  app.get("/api/reporting/cost", async (req, res) => {
    try {
      const { days, startDate, endDate, label, slug } = parseDateRange(req.query);

      // Usage aggregate with input vs output tokens
      const usageRes = await pool.query(
        `SELECT 
           COALESCE(COUNT(*), 0)::bigint as total_runs,
           COALESCE(SUM(prompt_tokens + response_tokens), 0)::bigint as total_tokens,
           COALESCE(SUM(prompt_tokens), 0)::bigint as input_tokens,
           COALESCE(SUM(response_tokens), 0)::bigint as output_tokens,
           COALESCE(SUM(cost_usd), 0)::numeric as total_cost,
           COALESCE(COUNT(CASE WHEN status != 'ok' THEN 1 END), 0)::bigint as total_errors,
           COALESCE(AVG(latency_ms), 0)::int as avg_latency
         FROM provider_usage
         WHERE created_at >= $1 AND created_at <= $2`,
        [startDate, endDate]
      );

      const uRow = usageRes.rows[0];
      const runs = Number(uRow.total_runs || 0);
      const tokens = Number(uRow.total_tokens || 0);
      const inputTokens = Number(uRow.input_tokens || 0);
      const outputTokens = Number(uRow.output_tokens || 0);
      const errors = Number(uRow.total_errors || 0);
      const latency = Number(uRow.avg_latency || 0);
      const successRate = runs > 0 ? Number((100 - (errors / runs) * 100).toFixed(2)) : 100;

      // Provider breakdown
      const providerRes = await pool.query(
        `SELECT 
           COALESCE(NULLIF(p.name, ''), COALESCE(NULLIF(u.provider_name, ''), 'Local sovereign runtime')) as label,
           COUNT(u.id)::bigint as runs,
           COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(u.cost_usd), 0)::numeric as cost
         FROM provider_usage u
         LEFT JOIN ai_providers p ON u.provider_id = p.id
         WHERE u.created_at >= $1 AND u.created_at <= $2
         GROUP BY 1
         ORDER BY cost DESC`,
        [startDate, endDate]
      );

      let providers = providerRes.rows.map((p) => ({
        label: p.label,
        runs: Number(p.runs),
        tokens: Number(p.tokens),
        cost: Number(Number(p.cost).toFixed(2)),
        share: tokens > 0 ? Number(((Number(p.tokens) / tokens) * 100).toFixed(1)) : 0,
      }));

      if (!providers.length) {
        providers = [
          { label: "Local sovereign runtime", runs: 0, tokens: 0, cost: 0, share: 100 },
        ];
      }

      // Squad breakdown
      const squadRes = await pool.query(
        `SELECT 
           COALESCE(NULLIF(a.squad, ''), 'Platform engineering') as label,
           COUNT(u.id)::bigint as runs,
           COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(u.cost_usd), 0)::numeric as cost
         FROM provider_usage u
         LEFT JOIN chat_threads ct ON u.thread_id = ct.id
         LEFT JOIN agents a ON ct.agent_id = a.id
         WHERE u.created_at >= $1 AND u.created_at <= $2
         GROUP BY 1
         ORDER BY cost DESC`,
        [startDate, endDate]
      );

      let squads = squadRes.rows.map((s) => ({
        label: s.label,
        runs: Number(s.runs),
        tokens: Number(s.tokens),
        cost: Number(Number(s.cost).toFixed(2)),
        share: runs > 0 ? Number(((Number(s.runs) / runs) * 100).toFixed(1)) : 0,
      }));

      if (!squads.length) {
        squads = [
          { label: "Platform engineering", runs: 0, tokens: 0, cost: 0, share: 100 },
        ];
      }

      // Storage metrics from knowledge_sources
      const storageRes = await pool.query(
        `SELECT 
           COALESCE(SUM(size_mb), 0)::numeric as total_mb,
           COALESCE(COUNT(*), 0)::bigint as total_docs
         FROM knowledge_sources`
      );
      const totalStorageMb = Number(storageRes.rows[0]?.total_mb || 0);
      const totalStorageGb = Number((totalStorageMb / 1024).toFixed(2));

      // Build structured cost line items
      const inputM = Number((inputTokens / 1_000_000).toFixed(2));
      const outputM = Number((outputTokens / 1_000_000).toFixed(2));
      const inputCost = Number((inputM * 2.10).toFixed(2));
      const outputCost = Number((outputM * 8.40).toFixed(2));
      const localOffload = providers.find((p) => p.label.toLowerCase().includes("local") || p.label.toLowerCase().includes("sovereign"))?.share || 100;
      const gpuHours = Number((runs / 260).toFixed(1));
      const gpuCost = Number((gpuHours * 1.15).toFixed(2));
      const vectorStorageCost = Number((Math.max(1, totalStorageGb) * 0.22).toFixed(2));
      const objectStorageCost = Number((Math.max(1, totalStorageGb * 2.8) * 0.021).toFixed(2));
      const egressCost = Number((Math.max(0.1, runs * 0.0005) * 0.08).toFixed(2));

      const lines = [
        {
          item: "Cloud inference · input tokens",
          category: "inference",
          unit: "1M tokens",
          quantity: `${inputM}M`,
          rate: "$2.10",
          amount: inputCost,
        },
        {
          item: "Cloud inference · output tokens",
          category: "inference",
          unit: "1M tokens",
          quantity: `${outputM}M`,
          rate: "$8.40",
          amount: outputCost,
        },
        {
          item: "Local runtime GPU hours",
          category: "infrastructure",
          unit: "GPU-hour",
          quantity: `${gpuHours}h`,
          rate: "$1.15",
          amount: gpuCost,
        },
        {
          item: "Vector store · resident index",
          category: "storage",
          unit: "GB-month",
          quantity: `${Math.max(1, totalStorageGb)}GB`,
          rate: "$0.22",
          amount: vectorStorageCost,
        },
        {
          item: "Object storage · artefacts & exports",
          category: "storage",
          unit: "GB-month",
          quantity: `${Number(Math.max(1, totalStorageGb * 2.8).toFixed(1))}GB`,
          rate: "$0.021",
          amount: objectStorageCost,
        },
        {
          item: "Egress · webhooks and deliveries",
          category: "egress",
          unit: "GB",
          quantity: `${Number(Math.max(0.1, runs * 0.0005).toFixed(2))}GB`,
          rate: "$0.08",
          amount: egressCost,
        },
      ];

      const ledgerTotal = Number(lines.reduce((a, l) => a + l.amount, 0).toFixed(2));
      const perRun = runs > 0 ? Number((ledgerTotal / runs).toFixed(4)) : 0;
      const perMillion = tokens > 0 ? Number((ledgerTotal / (tokens / 1_000_000)).toFixed(2)) : 0;

      // Daily burn curve
      const dailyRes = await pool.query(
        `SELECT 
           TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as day,
           COUNT(*)::bigint as runs,
           COALESCE(SUM(prompt_tokens + response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(cost_usd), 0)::numeric as cost,
           COUNT(CASE WHEN status != 'ok' THEN 1 END)::bigint as errors,
           COALESCE(AVG(latency_ms), 0)::int as latency
         FROM provider_usage
         WHERE created_at >= $1 AND created_at <= $2
         GROUP BY DATE_TRUNC('day', created_at)
         ORDER BY day ASC`,
        [startDate, endDate]
      );

      const dailyMap = new Map();
      for (const r of dailyRes.rows) {
        dailyMap.set(r.day, {
          day: r.day,
          runs: Number(r.runs),
          tokens: Number(r.tokens),
          cost: Number(Number(r.cost).toFixed(2)),
          errors: Number(r.errors),
          latency: Number(r.latency),
        });
      }

      const rows = [];
      const DAY_MS = 86_400_000;
      const startDayTime = new Date(startDate).getTime();
      for (let i = 0; i < days; i++) {
        const dStr = new Date(startDayTime + i * DAY_MS).toISOString().slice(0, 10);
        if (dailyMap.has(dStr)) {
          rows.push(dailyMap.get(dStr));
        } else {
          rows.push({ day: dStr, runs: 0, tokens: 0, cost: 0, errors: 0, latency: 0 });
        }
      }

      res.json({
        span: { label, slug, days },
        totals: { runs, tokens, cost: ledgerTotal, errors, latency, successRate },
        lines,
        ledgerTotal,
        perRun,
        perMillion,
        localOffload,
        rows,
        providers,
        squads,
      });
    } catch (err) {
      console.error("[Reporting API] Error in /api/reporting/cost:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  // =========================================================================
  // 4. GET /api/reporting/operators
  // =========================================================================
  app.get("/api/reporting/operators", async (req, res) => {
    try {
      const { days, startDate, endDate, label, slug } = parseDateRange(req.query);
      const topN = Number(req.query.topN || 0);
      const sortBy = String(req.query.sortBy || "tokens");
      const search = String(req.query.search || "").toLowerCase().trim();
      const onlyIds = req.query.userIds ? String(req.query.userIds).split(",").filter(Boolean) : [];

      // Fetch all app users (local and federated) and directory users
      let usersRows = [];
      try {
        const usersRes = await pool.query(`
          SELECT 
            id, 
            username, 
            COALESCE(NULLIF(display_name, ''), username) as name, 
            COALESCE(email, '') as email, 
            COALESCE(role, 'Operator') as role, 
            COALESCE(status, 'active') as status, 
            COALESCE(locked, false) as locked, 
            COALESCE(provider, 'local') as provider,
            COALESCE(groups, '[]'::jsonb) as groups,
            last_seen, 
            created_at 
          FROM app_users
          UNION ALL
          SELECT 
            id,
            username,
            COALESCE(NULLIF(name, ''), username) as name,
            COALESCE(email, '') as email,
            'Operator' as role,
            'active' as status,
            false as locked,
            source_key as provider,
            COALESCE(groups, '[]'::jsonb) as groups,
            null as last_seen,
            fetched_at as created_at
          FROM directory_users
          WHERE username NOT IN (SELECT username FROM app_users)
          ORDER BY name ASC
        `);
        usersRows = usersRes.rows;
      } catch (err) {
        // Fallback for clean app_users query if directory_users table is empty
        const fallbackRes = await pool.query(`
          SELECT 
            id, 
            username, 
            COALESCE(NULLIF(display_name, ''), username) as name, 
            COALESCE(email, '') as email, 
            COALESCE(role, 'Operator') as role, 
            COALESCE(status, 'active') as status, 
            COALESCE(locked, false) as locked, 
            COALESCE(provider, 'local') as provider,
            COALESCE(groups, '[]'::jsonb) as groups,
            last_seen, 
            created_at 
          FROM app_users
          ORDER BY username ASC
        `);
        usersRows = fallbackRes.rows;
      }

      // If no users in DB, provide standard admin and operator identities
      if (!usersRows.length) {
        usersRows = [
          {
            id: "u_admin",
            username: "admin",
            name: "Administrator",
            email: "admin@sovereign.studio",
            role: "Admin",
            status: "active",
            locked: false,
            provider: "local",
            groups: ["Platform engineering"],
            last_seen: "now",
            created_at: new Date().toISOString(),
          },
        ];
      }

      // Fetch user usage rollups
      const userUsageRes = await pool.query(
        `SELECT 
           COALESCE(ct.owner_id, ct.owner_name, 'admin') as user_id,
           COUNT(u.id)::bigint as runs,
           COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(u.prompt_tokens), 0)::bigint as input_tokens,
           COALESCE(SUM(u.response_tokens), 0)::bigint as output_tokens,
           COALESCE(SUM(CASE WHEN p.name ILIKE '%local%' OR u.provider_name ILIKE '%local%' THEN (u.prompt_tokens + u.response_tokens) ELSE 0 END), 0)::bigint as local_tokens,
           COALESCE(SUM(CASE WHEN NOT (p.name ILIKE '%local%' OR u.provider_name ILIKE '%local%') THEN (u.prompt_tokens + u.response_tokens) ELSE 0 END), 0)::bigint as cloud_tokens,
           COALESCE(SUM(u.cost_usd), 0)::numeric as cost,
           COALESCE(SUM(CASE WHEN NOT (p.name ILIKE '%local%' OR u.provider_name ILIKE '%local%') THEN u.cost_usd ELSE 0 END), 0)::numeric as cloud_cost,
           COALESCE(SUM(CASE WHEN p.name ILIKE '%local%' OR u.provider_name ILIKE '%local%' THEN u.cost_usd ELSE 0 END), 0)::numeric as local_cost,
           COUNT(CASE WHEN u.status != 'ok' THEN 1 END)::bigint as errors,
           COALESCE(AVG(u.latency_ms), 0)::int as latency
         FROM provider_usage u
         LEFT JOIN chat_threads ct ON u.thread_id = ct.id
         LEFT JOIN ai_providers p ON u.provider_id = p.id
         WHERE u.created_at >= $1 AND u.created_at <= $2
         GROUP BY 1`,
        [startDate, endDate]
      );

      const usageByUser = new Map();
      for (const row of userUsageRes.rows) {
        usageByUser.set(row.user_id, row);
      }

      // Fetch daily activity per user for deep dive sparklines
      const userDailyRes = await pool.query(
        `SELECT 
           COALESCE(ct.owner_id, ct.owner_name, 'admin') as user_id,
           TO_CHAR(DATE_TRUNC('day', u.created_at), 'YYYY-MM-DD') as day,
           COUNT(u.id)::bigint as runs,
           COALESCE(SUM(u.prompt_tokens + u.response_tokens), 0)::bigint as tokens,
           COALESCE(SUM(u.cost_usd), 0)::numeric as cost
         FROM provider_usage u
         LEFT JOIN chat_threads ct ON u.thread_id = ct.id
         WHERE u.created_at >= $1 AND u.created_at <= $2
         GROUP BY 1, 2
         ORDER BY day ASC`,
        [startDate, endDate]
      );

      const dailyByUser = new Map();
      for (const row of userDailyRes.rows) {
        if (!dailyByUser.has(row.user_id)) dailyByUser.set(row.user_id, new Map());
        dailyByUser.get(row.user_id).set(row.day, row);
      }

      const DAY_MS = 86_400_000;
      const startDayTime = new Date(startDate).getTime();

      // Build operator list
      let operators = usersRows.map((acc) => {
        const u = usageByUser.get(acc.id) || usageByUser.get(acc.username) || {};
        const runs = Number(u.runs || 0);
        const tokens = Number(u.tokens || 0);
        const inputTokens = Number(u.input_tokens || 0);
        const outputTokens = Number(u.output_tokens || 0);
        const localTokens = Number(u.local_tokens || (runs > 0 ? tokens : 0));
        const cloudTokens = Number(u.cloud_tokens || 0);
        const cost = Number(Number(u.cost || 0).toFixed(2));
        const cloudCost = Number(Number(u.cloud_cost || 0).toFixed(2));
        const localCost = Number(Number(u.local_cost || 0).toFixed(2));
        const errors = Number(u.errors || 0);
        const latency = Number(u.latency || 0);
        const successRate = runs > 0 ? Number((100 - (errors / runs) * 100).toFixed(2)) : 100;

        // Daily series for this operator
        const userDaysMap = dailyByUser.get(acc.id) || dailyByUser.get(acc.username) || new Map();
        const series = [];
        for (let i = 0; i < days; i++) {
          const dStr = new Date(startDayTime + i * DAY_MS).toISOString().slice(0, 10);
          const dRec = userDaysMap.get(dStr);
          series.push({
            day: dStr,
            runs: dRec ? Number(dRec.runs) : 0,
            tokens: dRec ? Number(dRec.tokens) : 0,
            cost: dRec ? Number(Number(dRec.cost).toFixed(2)) : 0,
          });
        }

        return {
          id: acc.id,
          name: acc.name || acc.username,
          username: acc.username,
          email: acc.email || `${acc.username}@sovereign.studio`,
          role: acc.role || "Operator",
          status: acc.status || "active",
          locked: !!acc.locked,
          provider: acc.provider || "local",
          groups: Array.isArray(acc.groups) ? acc.groups : [],
          runs,
          tokens,
          localTokens,
          cloudTokens,
          inputTokens,
          outputTokens,
          cost,
          localCost,
          cloudCost,
          errors,
          successRate,
          latency,
          sessions: Math.max(1, Math.round(runs * 0.4)),
          approvals: 0,
          toolCalls: Math.max(0, Math.round(runs * 0.6)),
          lastSeen: acc.last_seen || "recently active",
          series,
          workloads: [
            { label: "Sovereign chat", runs, tokens, cost, share: 100 },
          ],
          models: [
            { label: "sovereign-local-runtime", runs, tokens, cost, share: 100 },
          ],
          activity: [],
        };
      });

      // Filter by search
      if (search) {
        operators = operators.filter(
          (o) =>
            o.name.toLowerCase().includes(search) ||
            o.username.toLowerCase().includes(search) ||
            o.email.toLowerCase().includes(search) ||
            o.role.toLowerCase().includes(search) ||
            o.provider.toLowerCase().includes(search)
        );
      }

      // Filter by user IDs
      if (onlyIds.length) {
        operators = operators.filter((o) => onlyIds.includes(o.id));
      }

      // Sort
      operators.sort((a, b) => {
        if (sortBy === "tokens") return b.tokens - a.tokens;
        if (sortBy === "cost") return b.cost - a.cost;
        if (sortBy === "runs") return b.runs - a.runs;
        return a.name.localeCompare(b.name);
      });

      // Top N slice
      if (topN > 0) {
        operators = operators.slice(0, topN);
      }

      // Roster totals
      const rosterTotals = {
        operators: operators.length,
        runs: operators.reduce((a, o) => a + o.runs, 0),
        tokens: operators.reduce((a, o) => a + o.tokens, 0),
        localTokens: operators.reduce((a, o) => a + o.localTokens, 0),
        cloudTokens: operators.reduce((a, o) => a + o.cloudTokens, 0),
        cost: Number(operators.reduce((a, o) => a + o.cost, 0).toFixed(2)),
        cloudCost: Number(operators.reduce((a, o) => a + o.cloudCost, 0).toFixed(2)),
      };

      res.json({
        span: { label, slug, days },
        operators,
        totals: rosterTotals,
      });
    } catch (err) {
      console.error("[Reporting API] Error in /api/reporting/operators:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  // =========================================================================
  // 5. GET /api/reporting/rag & POST /api/reporting/rag/query
  // =========================================================================
  app.get("/api/reporting/rag", async (req, res) => {
    try {
      const { days, startDate, endDate, label, slug } = parseDateRange(req.query);

      // Fetch knowledge sources
      const sourcesRes = await pool.query(
        `SELECT id, name, space_id, owner_id, owner_name, size_mb, chunks, status, added_at, metadata
         FROM knowledge_sources
         ORDER BY added_at DESC`
      );

      // Fetch RAG retrieval queries
      const queriesRes = await pool.query(
        `SELECT id, at, query, principal, principal_id, agent, spaces, blocked, docs, chunks, hit
         FROM rag_queries
         WHERE at >= $1 AND at <= $2
         ORDER BY at DESC
         LIMIT 200`,
        [startDate, endDate]
      );

      // Knowledge spaces
      const spacesRes = await pool.query(`SELECT id, name FROM knowledge_spaces`);
      const spacesMap = new Map(spacesRes.rows.map((s) => [s.id, s.name]));

      const startMs = new Date(startDate).getTime();
      const endMs = new Date(endDate).getTime();

      const docs = sourcesRes.rows.map((s) => ({
        id: s.id,
        name: s.name,
        space: s.space_id,
        spaceName: spacesMap.get(s.space_id) || "General",
        ownerId: s.owner_id,
        ownerName: s.owner_name || "admin",
        sizeMb: Number(s.size_mb || 0),
        chunks: Number(s.chunks || 0),
        status: s.status || "indexed",
        addedAt: s.added_at ? new Date(s.added_at).getTime() : 0,
      }));

      const filteredDocs = docs.filter(
        (d) => d.addedAt >= startMs && d.addedAt <= endMs
      );

      const queries = queriesRes.rows.map((q) => ({
        id: q.id,
        at: new Date(q.at).getTime(),
        query: q.query,
        principal: q.principal || "admin",
        principalId: q.principal_id || "admin",
        agent: q.agent || "Sovereign Brain",
        spaces: Array.isArray(q.spaces) ? q.spaces : [],
        blocked: Number(q.blocked || 0),
        docs: Number(q.docs || 0),
        chunks: Number(q.chunks || 0),
        hit: !!q.hit,
      }));

      // Aggregates
      const totalMb = docs.reduce((a, d) => a + d.sizeMb, 0);
      const chunks = docs.reduce((a, d) => a + d.chunks, 0);
      const indexed = docs.filter((d) => d.status === "indexed").length;
      const pending = docs.filter((d) => d.status === "pending").length;

      // Daily trend
      const daily = [];
      const DAY_MS = 86_400_000;
      for (let i = days - 1; i >= 0; i--) {
        const fromMs = endMs - (i + 1) * DAY_MS;
        const toMs = fromMs + DAY_MS;
        const dDay = docs.filter((d) => d.addedAt >= fromMs && d.addedAt < toMs);
        const qDay = queries.filter((q) => q.at >= fromMs && q.at < toMs);

        daily.push({
          day: new Date(fromMs).toISOString().slice(0, 10),
          mb: Number(dDay.reduce((a, d) => a + d.sizeMb, 0).toFixed(2)),
          docs: dDay.length,
          queries: qDay.length,
        });
      }

      res.json({
        span: { label, slug, days },
        stats: {
          totalDocs: docs.length,
          totalMb: Number(totalMb.toFixed(2)),
          chunks,
          indexed,
          pending,
          totalQueries: queries.length,
        },
        docs,
        filteredDocs,
        queries,
        daily,
      });
    } catch (err) {
      console.error("[Reporting API] Error in /api/reporting/rag:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  // Log a retrieval query event
  app.post("/api/reporting/rag/query", async (req, res) => {
    try {
      const b = req.body || {};
      const id = b.id || `rq.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 6)}`;
      await pool.query(
        `INSERT INTO rag_queries (id, at, query, principal, principal_id, agent, spaces, blocked, docs, chunks, hit)
         VALUES ($1, now(), $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
        [
          id,
          b.query || "",
          b.principal || "admin",
          b.principalId || "admin",
          b.agent || "Sovereign Brain",
          JSON.stringify(b.spaces || []),
          Number(b.blocked || 0),
          Number(b.docs || 0),
          Number(b.chunks || 0),
          !!b.hit,
        ]
      );
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  // =========================================================================
  // 6. SCHEDULES CRUD & DELIVERY LOGGING
  // =========================================================================
  app.get("/api/reporting/schedules", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM schedules ORDER BY created_at ASC`
      );

      res.json(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          templateId: r.template_id,
          period: r.period,
          rangeFrom: r.range_from,
          rangeTo: r.range_to,
          topN: r.top_n,
          sortBy: r.sort_by,
          userId: r.user_id,
          format: r.format || "PDF",
          delivery: r.delivery || "email",
          recipients: r.recipients || "",
          destination: r.destination || "",
          cadence: r.cadence || "daily",
          time: r.run_time || "08:00",
          weekday: r.weekday ?? 1,
          dayOfMonth: r.day_of_month ?? 1,
          enabled: !!r.enabled,
          nextRun: r.next_run ? new Date(r.next_run).toISOString() : "",
          lastRun: r.last_run ? new Date(r.last_run).toISOString() : "",
          status: r.status || "idle",
          ownerId: r.owner_id,
          ownerName: r.owner_name,
          visibility: r.visibility || "private",
          sharedWith: r.shared_with || [],
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        }))
      );
    } catch (err) {
      console.error("[Reporting API] Error in GET /api/reporting/schedules:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  app.post("/api/reporting/schedules", async (req, res) => {
    try {
      const b = req.body || {};
      const id = b.id || `sch.${Date.now().toString(36)}`;
      const actor = req.session?.username || req.actor || "admin";

      await pool.query(
        `INSERT INTO schedules (
           id, name, template_id, period, range_from, range_to, top_n, sort_by, user_id,
           format, delivery, recipients, destination, cadence, run_time, weekday, day_of_month,
           enabled, next_run, last_run, status, owner_id, owner_name, visibility, shared_with, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14, $15, $16, $17,
           $18, $19, $20, $21, $22, $23, $24, $25::jsonb, now()
         )
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, template_id=EXCLUDED.template_id, period=EXCLUDED.period,
           range_from=EXCLUDED.range_from, range_to=EXCLUDED.range_to, top_n=EXCLUDED.top_n,
           sort_by=EXCLUDED.sort_by, user_id=EXCLUDED.user_id, format=EXCLUDED.format,
           delivery=EXCLUDED.delivery, recipients=EXCLUDED.recipients, destination=EXCLUDED.destination,
           cadence=EXCLUDED.cadence, run_time=EXCLUDED.run_time, weekday=EXCLUDED.weekday,
           day_of_month=EXCLUDED.day_of_month, enabled=EXCLUDED.enabled, next_run=EXCLUDED.next_run,
           last_run=EXCLUDED.last_run, status=EXCLUDED.status, visibility=EXCLUDED.visibility`,
        [
          id,
          b.name || "Untitled Schedule",
          b.templateId || "executive",
          b.period || "30d",
          b.rangeFrom || null,
          b.rangeTo || null,
          Number(b.topN || 0),
          b.sortBy || "tokens",
          b.userId || null,
          b.format || "PDF",
          b.delivery || "email",
          b.recipients || "",
          b.destination || "",
          b.cadence || "daily",
          b.time || "08:00",
          b.weekday ?? 1,
          b.dayOfMonth ?? 1,
          !!b.enabled,
          b.nextRun ? new Date(b.nextRun) : null,
          b.lastRun ? new Date(b.lastRun) : null,
          b.status || "idle",
          b.ownerId || actor,
          b.ownerName || actor,
          b.visibility || "private",
          JSON.stringify(b.sharedWith || []),
        ]
      );

      res.json({ ok: true, id });
    } catch (err) {
      console.error("[Reporting API] Error in POST /api/reporting/schedules:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  app.put("/api/reporting/schedules/:id", async (req, res) => {
    try {
      const b = req.body || {};
      const id = req.params.id;

      await pool.query(
        `UPDATE schedules SET
           name = COALESCE($2, name),
           template_id = COALESCE($3, template_id),
           period = COALESCE($4, period),
           range_from = $5,
           range_to = $6,
           top_n = COALESCE($7, top_n),
           sort_by = COALESCE($8, sort_by),
           user_id = $9,
           format = COALESCE($10, format),
           delivery = COALESCE($11, delivery),
           recipients = COALESCE($12, recipients),
           destination = COALESCE($13, destination),
           cadence = COALESCE($14, cadence),
           run_time = COALESCE($15, run_time),
           weekday = COALESCE($16, weekday),
           day_of_month = COALESCE($17, day_of_month),
           enabled = COALESCE($18, enabled),
           next_run = $19,
           last_run = $20,
           status = COALESCE($21, status),
           visibility = COALESCE($22, visibility)
         WHERE id = $1`,
        [
          id,
          b.name,
          b.templateId,
          b.period,
          b.rangeFrom || null,
          b.rangeTo || null,
          b.topN !== undefined ? Number(b.topN) : null,
          b.sortBy,
          b.userId || null,
          b.format,
          b.delivery,
          b.recipients,
          b.destination,
          b.cadence,
          b.time,
          b.weekday !== undefined ? Number(b.weekday) : null,
          b.dayOfMonth !== undefined ? Number(b.dayOfMonth) : null,
          b.enabled !== undefined ? !!b.enabled : null,
          b.nextRun ? new Date(b.nextRun) : null,
          b.lastRun ? new Date(b.lastRun) : null,
          b.status,
          b.visibility,
        ]
      );

      res.json({ ok: true, id });
    } catch (err) {
      console.error("[Reporting API] Error in PUT /api/reporting/schedules:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  app.delete("/api/reporting/schedules/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM schedules WHERE id = $1`, [req.params.id]);
      res.status(204).end();
    } catch (err) {
      console.error("[Reporting API] Error in DELETE /api/reporting/schedules:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  app.get("/api/reporting/deliveries", async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM schedule_deliveries ORDER BY at DESC LIMIT 60`
      );

      res.json(
        rows.map((r) => ({
          id: r.id,
          scheduleId: r.schedule_id,
          name: r.name,
          at: r.at ? new Date(r.at).toISOString() : "",
          channel: r.channel,
          format: r.format,
          target: r.target,
          outcome: r.outcome,
          detail: r.detail,
        }))
      );
    } catch (err) {
      console.error("[Reporting API] Error in GET /api/reporting/deliveries:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });

  app.post("/api/reporting/deliveries", async (req, res) => {
    try {
      const b = req.body || {};
      const id = b.id || `dlv.${Date.now()}.${Math.random().toString(36).slice(2, 7)}`;

      await pool.query(
        `INSERT INTO schedule_deliveries (id, schedule_id, name, at, channel, format, target, outcome, detail)
         VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8)`,
        [
          id,
          b.scheduleId || null,
          b.name || "Delivery",
          b.channel || "email",
          b.format || "PDF",
          b.target || "",
          b.outcome || "delivered",
          b.detail || "",
        ]
      );

      res.json({ ok: true, id });
    } catch (err) {
      console.error("[Reporting API] Error in POST /api/reporting/deliveries:", err);
      res.status(500).json({ error: String(err.message || err) });
    }
  });
}
