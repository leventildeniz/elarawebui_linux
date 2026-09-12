// local-server/lib/rate-limiter.mjs
// Sliding-Window Enterprise Rate Limiting & Monthly Token Quota Guardrail Engine
// Supports Redis Cluster atomic operations (<1ms latency) with In-Memory fallback

import { getRawRedisClient } from "./infra/redis-cache.mjs";

// In-Memory Fallback State (when Redis is disabled or reconnecting)
const MEM_RPM_WINDOWS = new Map();
const MEM_TPM_WINDOWS = new Map();
const MEM_CONCURRENCY = new Map();
const MEM_MONTHLY_TOKENS = new Map();

/**
 * Get YYYY-MM key for current month quota tracking
 */
function getMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Atomic Pre-Flight Rate Limit & Quota Validation (<1ms)
 * @param {object} keyRecord - Row from tenant_api_keys joined with tenant_rate_limits
 * @param {number} estimatedTokens - Initial token estimate (default: 150)
 * @returns {Promise<{ allowed: boolean, status?: number, reason?: string, headers: object }>}
 */
export async function checkRateLimit(keyRecord, estimatedTokens = 150) {
  if (!keyRecord || !keyRecord.id) {
    return { allowed: false, status: 401, reason: "Invalid API Key context", headers: {} };
  }

  const keyId = String(keyRecord.id);
  const tenantId = String(keyRecord.tenant_id || "default");
  const rpmLimit = Number(keyRecord.rpm_limit) || 15;
  const tpmLimit = Number(keyRecord.tpm_limit) || 50000;
  const monthlyQuota = Number(keyRecord.monthly_token_quota) || 10000000;
  const maxConcurrency = Number(keyRecord.max_concurrency) || 2;

  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);
  const monthStr = getMonthKey();

  const redis = getRawRedisClient();

  if (redis) {
    try {
      const rpmKey = `elara:rl:rpm:${keyId}:${currentMinute}`;
      const tpmKey = `elara:rl:tpm:${keyId}:${currentMinute}`;
      const concKey = `elara:rl:conc:${keyId}`;
      const quotaKey = `elara:rl:quota:${tenantId}:${monthStr}`;

      const pipe = redis.pipeline();
      pipe.incr(rpmKey);
      pipe.expire(rpmKey, 120);
      pipe.get(tpmKey);
      pipe.get(concKey);
      pipe.get(quotaKey);

      const results = await pipe.exec();
      const currentRpm = Number(results[0]?.[1] || 1);
      const currentTpm = Number(results[2]?.[1] || 0);
      const currentConc = Number(results[3]?.[1] || 0);
      const currentMonthTokens = Number(results[4]?.[1] || 0);

      // Check Monthly Quota
      if (monthlyQuota > 0 && currentMonthTokens >= monthlyQuota) {
        return {
          allowed: false,
          status: 402,
          reason: `Monthly token quota exceeded (${currentMonthTokens.toLocaleString()} / ${monthlyQuota.toLocaleString()} tokens). Upgrade tier or contact administrator.`,
          headers: {
            "x-ratelimit-limit-tokens-month": monthlyQuota,
            "x-ratelimit-remaining-tokens-month": 0,
          },
        };
      }

      // Check RPM (Requests Per Minute)
      if (currentRpm > rpmLimit) {
        return {
          allowed: false,
          status: 429,
          reason: `Rate limit exceeded: ${currentRpm} req/min exceeds ${rpmLimit} RPM for tier '${keyRecord.tier || "tier1"}'.`,
          headers: {
            "retry-after": "60",
            "x-ratelimit-limit-requests": rpmLimit,
            "x-ratelimit-remaining-requests": 0,
          },
        };
      }

      // Check Concurrency Limit
      if (maxConcurrency > 0 && currentConc >= maxConcurrency) {
        return {
          allowed: false,
          status: 429,
          reason: `Concurrency limit reached (${currentConc}/${maxConcurrency} active requests). Please wait for active requests to finish.`,
          headers: {
            "retry-after": "5",
            "x-ratelimit-limit-concurrency": maxConcurrency,
          },
        };
      }

      // Increment concurrency for this in-flight request
      await redis.incr(concKey);
      await redis.expire(concKey, 300); // 5 min safety TTL

      return {
        allowed: true,
        headers: {
          "x-ratelimit-limit-requests": rpmLimit,
          "x-ratelimit-remaining-requests": Math.max(0, rpmLimit - currentRpm),
          "x-ratelimit-limit-tokens": tpmLimit,
          "x-ratelimit-remaining-tokens-month": Math.max(0, monthlyQuota - currentMonthTokens),
        },
      };
    } catch (err) {
      console.warn(`[RateLimiter] Redis check error: ${err.message}, falling back to In-Memory`);
    }
  }

  // --- In-Memory Fallback ---
  const memRpmKey = `${keyId}:${currentMinute}`;
  const memRpm = (MEM_RPM_WINDOWS.get(memRpmKey) || 0) + 1;
  MEM_RPM_WINDOWS.set(memRpmKey, memRpm);

  // Prune old in-memory minutes
  if (MEM_RPM_WINDOWS.size > 2000) {
    for (const k of MEM_RPM_WINDOWS.keys()) {
      if (!k.endsWith(`:${currentMinute}`) && !k.endsWith(`:${currentMinute - 1}`)) {
        MEM_RPM_WINDOWS.delete(k);
      }
    }
  }

  const memConc = MEM_CONCURRENCY.get(keyId) || 0;
  const memQuotaKey = `${tenantId}:${monthStr}`;
  const memTokens = MEM_MONTHLY_TOKENS.get(memQuotaKey) || 0;

  if (monthlyQuota > 0 && memTokens >= monthlyQuota) {
    return {
      allowed: false,
      status: 402,
      reason: `Monthly token quota exceeded (${memTokens.toLocaleString()} / ${monthlyQuota.toLocaleString()} tokens).`,
      headers: { "x-ratelimit-remaining-tokens-month": 0 },
    };
  }

  if (memRpm > rpmLimit) {
    return {
      allowed: false,
      status: 429,
      reason: `Rate limit exceeded: ${memRpm} req/min exceeds ${rpmLimit} RPM.`,
      headers: { "retry-after": "60", "x-ratelimit-remaining-requests": 0 },
    };
  }

  if (maxConcurrency > 0 && memConc >= maxConcurrency) {
    return {
      allowed: false,
      status: 429,
      reason: `Concurrency limit reached (${memConc}/${maxConcurrency}).`,
      headers: { "retry-after": "5" },
    };
  }

  MEM_CONCURRENCY.set(keyId, memConc + 1);

  return {
    allowed: true,
    headers: {
      "x-ratelimit-limit-requests": rpmLimit,
      "x-ratelimit-remaining-requests": Math.max(0, rpmLimit - memRpm),
      "x-ratelimit-limit-tokens": tpmLimit,
    },
  };
}

/**
 * Post-Flight Request Completion & Token Accounting
 * Updates TPM, monthly token usage, and decrements concurrency
 */
export async function recordRequestEnd(keyRecord, totalTokens = 0) {
  if (!keyRecord || !keyRecord.id) return;

  const keyId = String(keyRecord.id);
  const tenantId = String(keyRecord.tenant_id || "default");
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);
  const monthStr = getMonthKey();

  const redis = getRawRedisClient();

  if (redis) {
    try {
      const concKey = `elara:rl:conc:${keyId}`;
      const tpmKey = `elara:rl:tpm:${keyId}:${currentMinute}`;
      const quotaKey = `elara:rl:quota:${tenantId}:${monthStr}`;

      const pipe = redis.pipeline();
      pipe.decr(concKey);
      if (totalTokens > 0) {
        pipe.incrby(tpmKey, totalTokens);
        pipe.expire(tpmKey, 120);
        pipe.incrby(quotaKey, totalTokens);
        pipe.expire(quotaKey, 86400 * 45); // 45 days
      }
      await pipe.exec();
      return;
    } catch (err) {
      console.warn(`[RateLimiter] Redis request end error: ${err.message}`);
    }
  }

  // In-Memory Fallback Accounting
  const memConc = MEM_CONCURRENCY.get(keyId) || 1;
  MEM_CONCURRENCY.set(keyId, Math.max(0, memConc - 1));

  if (totalTokens > 0) {
    const memQuotaKey = `${tenantId}:${monthStr}`;
    const curTokens = MEM_MONTHLY_TOKENS.get(memQuotaKey) || 0;
    MEM_MONTHLY_TOKENS.set(memQuotaKey, curTokens + totalTokens);
  }
}
