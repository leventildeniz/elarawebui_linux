// local-server/lib/infra/redis-cache.mjs
// High-Performance Semantic LLM Caching Tier with In-Memory LRU Fallback & Vector Cosine Matching

import Redis from "ioredis";
import crypto from "node:crypto";

let _redisClient = null;
let _pool = null;
let _isEnabled = false;
let _isSemanticCacheEnabled = true;
let _defaultTtlSeconds = 86400; // 24 hours default
let _activeUri = "redis://127.0.0.1:6379";

// Fast In-Memory Fallback Cache (LRU-bounded to 500 items to avoid RAM bloat)
const IN_MEMORY_CACHE = new Map();
const MAX_IN_MEMORY_ITEMS = 500;
let _hitsCount = 0;
let _missesCount = 0;

// Dot product & cosine similarity math for 384-dim embeddings
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function hashText(text) {
  return crypto.createHash("sha256").update(String(text).trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * Initialize Redis Client from DB configuration or environment fallback
 */
export async function initRedisCache(pool) {
  _pool = pool;
  try {
    const { rows } = await pool.query("SELECT value FROM app_settings WHERE key='infra.redis'");
    const cfg = rows[0]?.value || {};
    _isEnabled = !!cfg.enabled;
    _isSemanticCacheEnabled = cfg.semanticCache !== false;
    _defaultTtlSeconds = Number(cfg.ttlSeconds) || 86400;
    _activeUri = cfg.uri || process.env.REDIS_URL || "redis://127.0.0.1:6379";

    if (_isEnabled && !_redisClient) {
      _redisClient = new Redis(_activeUri, {
        maxRetriesPerRequest: 2,
        connectTimeout: 3000,
        enableOfflineQueue: false,
        retryStrategy(times) {
          if (times > 5) return null; // stop reconnecting after 5 attempts
          return Math.min(times * 500, 2000);
        },
      });

      _redisClient.on("connect", () => {
        console.log(`[Redis] ✅ Semantic cache connected to ${_activeUri}`);
      });

      _redisClient.on("error", (err) => {
        console.warn(`[Redis] ⚠️ Connection warning: ${err.message}. Using In-Memory fallback.`);
      });
    }
  } catch (e) {
    console.warn(`[Redis] Initialization notice: ${e.message}`);
  }
}

/**
 * Check semantic cache for identical or high-confidence (>0.98 similarity) cached response for the specific model
 */
export async function getSemanticCache(queryEmbedding, queryText, modelId = "default", threshold = 0.98) {
  if (!_isSemanticCacheEnabled || !queryText) {
    return { hit: false };
  }

  const modelKey = String(modelId || "default").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const exactKey = `elara:semcache:${modelKey}:exact:${hashText(queryText)}`;

  // 1. Try Redis Exact & Semantic Match
  if (_isEnabled && _redisClient && _redisClient.status === "ready") {
    try {
      // 1a. Instant Exact Match (<1ms)
      const exactCached = await _redisClient.get(exactKey);
      if (exactCached) {
        const parsed = JSON.parse(exactCached);
        _hitsCount++;
        return {
          hit: true,
          response: parsed.response,
          score: 1.0,
          source: "redis-exact",
          model: parsed.model,
          promptTokens: parsed.promptTokens,
        };
      }

      // 1b. Vector Semantic Scan (if embedding is provided)
      if (Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
        const keys = await _redisClient.keys(`elara:semcache:${modelKey}:vec:*`);
        if (keys.length > 0) {
          const values = await _redisClient.mget(keys.slice(0, 100)); // scan up to 100 recent entries
          let bestMatch = null;
          let bestScore = -1;

          for (const raw of values) {
            if (!raw) continue;
            try {
              const item = JSON.parse(raw);
              if (item.embedding) {
                const sim = cosineSimilarity(queryEmbedding, item.embedding);
                if (sim > bestScore && sim >= threshold) {
                  bestScore = sim;
                  bestMatch = item;
                }
              }
            } catch {}
          }

          if (bestMatch && bestScore >= threshold) {
            _hitsCount++;
            return {
              hit: true,
              response: bestMatch.response,
              score: Math.round(bestScore * 1000) / 1000,
              source: "redis-semantic",
              model: bestMatch.model,
            };
          }
        }
      }
    } catch (err) {
      console.warn(`[Redis] Get cache error: ${err.message}`);
    }
  }

  // 2. In-Memory Fallback Cache (Model Scoped)
  const memExact = IN_MEMORY_CACHE.get(exactKey);
  if (memExact && Date.now() < memExact.expiresAt) {
    _hitsCount++;
    return {
      hit: true,
      response: memExact.response,
      score: 1.0,
      source: "memory-exact",
      model: memExact.model,
    };
  }

  if (Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
    let memBest = null;
    let memScore = -1;
    const now = Date.now();
    const vecPrefix = `elara:semcache:${modelKey}:vec:`;

    for (const [k, item] of IN_MEMORY_CACHE.entries()) {
      if (!k.startsWith(vecPrefix)) continue;
      if (item.expiresAt && now > item.expiresAt) {
        IN_MEMORY_CACHE.delete(k);
        continue;
      }
      if (item.embedding) {
        const sim = cosineSimilarity(queryEmbedding, item.embedding);
        if (sim > memScore && sim >= threshold) {
          memScore = sim;
          memBest = item;
        }
      }
    }

    if (memBest && memScore >= threshold) {
      _hitsCount++;
      return {
        hit: true,
        response: memBest.response,
        score: Math.round(memScore * 1000) / 1000,
        source: "memory-semantic",
        model: memBest.model,
      };
    }
  }

  _missesCount++;
  return { hit: false };
}

/**
 * Store LLM response and query embedding in semantic cache scoped per model
 */
export async function setSemanticCache(queryEmbedding, queryText, responseText, meta = {}, ttlSeconds = null) {
  if (!_isSemanticCacheEnabled || !queryText || !responseText) return;

  const modelKey = String(meta.model || "default").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const ttl = ttlSeconds || _defaultTtlSeconds;
  const hash = hashText(queryText);
  const exactKey = `elara:semcache:${modelKey}:exact:${hash}`;
  const vecKey = `elara:semcache:${modelKey}:vec:${hash}`;

  const payload = {
    query: queryText,
    response: responseText,
    embedding: Array.isArray(queryEmbedding) ? queryEmbedding : null,
    model: meta.model || null,
    ts: Date.now(),
  };

  const payloadStr = JSON.stringify(payload);

  // 1. Write to Redis if online
  if (_isEnabled && _redisClient && _redisClient.status === "ready") {
    try {
      const pipeline = _redisClient.pipeline();
      pipeline.set(exactKey, payloadStr, "EX", ttl);
      if (payload.embedding) {
        pipeline.set(vecKey, payloadStr, "EX", ttl);
      }
      await pipeline.exec();
    } catch (err) {
      console.warn(`[Redis] Set cache error: ${err.message}`);
    }
  }

  // 2. Always store in bounded In-Memory LRU
  if (IN_MEMORY_CACHE.size >= MAX_IN_MEMORY_ITEMS) {
    const oldestKey = IN_MEMORY_CACHE.keys().next().value;
    if (oldestKey) IN_MEMORY_CACHE.delete(oldestKey);
  }

  IN_MEMORY_CACHE.set(exactKey, {
    ...payload,
    expiresAt: Date.now() + ttl * 1000,
  });

  if (payload.embedding) {
    IN_MEMORY_CACHE.set(vecKey, {
      ...payload,
      expiresAt: Date.now() + ttl * 1000,
    });
  }
}

/**
 * Return live cache telemetry and health metrics
 */
export function getRedisCacheStats() {
  const total = _hitsCount + _missesCount;
  const hitRate = total > 0 ? Number(((_hitsCount / total) * 100).toFixed(1)) : 0;

  return {
    enabled: _isEnabled,
    connected: _isEnabled && _redisClient && _redisClient.status === "ready",
    mode: _isEnabled && _redisClient?.status === "ready" ? "redis-cluster" : "in-memory-fallback",
    hits: _hitsCount,
    misses: _missesCount,
    hitRate,
    inMemoryEntries: IN_MEMORY_CACHE.size,
  };
}
