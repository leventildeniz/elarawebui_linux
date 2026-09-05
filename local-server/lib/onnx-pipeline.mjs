// local-server/lib/onnx-pipeline.mjs
// Native In-Process ONNX Runtime Engine for ELARA Sovereign Studio
// Platform-Agnostic, Zero-IPC, Zero-Python embedding and reranking.

import { pipeline, AutoTokenizer, AutoModelForSequenceClassification, env } from "@xenova/transformers";
import path from "node:path";

// Ensure local cache directory and safe defaults
env.cacheDir = path.resolve(process.cwd(), ".cache");
env.allowLocalModels = true;
env.useBrowserCache = false;

let _embedPipeline = null;
let _embedLoadingPromise = null;

let _rerankTokenizer = null;
let _rerankModel = null;
let _rerankLoadingPromise = null;

let _status = {
  embedReady: false,
  rerankReady: false,
  embedModel: "Xenova/bge-small-en-v1.5",
  rerankModel: "Xenova/bge-reranker-base",
  engine: "onnxruntime-in-process",
  lastEmbedMs: 0,
  lastRerankMs: 0,
  lastError: null,
};

/**
 * Initialize / Warm up Embedding Pipeline
 */
export async function getEmbedPipeline() {
  if (_embedPipeline) return _embedPipeline;
  if (_embedLoadingPromise) return _embedLoadingPromise;

  _embedLoadingPromise = (async () => {
    try {
      const t0 = Date.now();
      const pipe = await pipeline("feature-extraction", _status.embedModel, {
        quantized: true,
      });
      _embedPipeline = pipe;
      _status.embedReady = true;
      console.log(`[onnx-pipeline] Embedding model ${_status.embedModel} loaded in ${Date.now() - t0}ms`);
      return _embedPipeline;
    } catch (e) {
      _status.lastError = `embed_load_failed: ${e?.message || e}`;
      console.error("[onnx-pipeline] Failed to load ONNX embedding model:", e);
      throw e;
    } finally {
      _embedLoadingPromise = null;
    }
  })();

  return _embedLoadingPromise;
}

/**
 * Initialize / Warm up Reranker Pipeline
 */
export async function getRerankPipeline() {
  if (_rerankTokenizer && _rerankModel) {
    return { tokenizer: _rerankTokenizer, model: _rerankModel };
  }
  if (_rerankLoadingPromise) return _rerankLoadingPromise;

  _rerankLoadingPromise = (async () => {
    try {
      const t0 = Date.now();
      const [tok, mdl] = await Promise.all([
        AutoTokenizer.from_pretrained(_status.rerankModel),
        AutoModelForSequenceClassification.from_pretrained(_status.rerankModel, {
          quantized: true,
        }),
      ]);
      _rerankTokenizer = tok;
      _rerankModel = mdl;
      _status.rerankReady = true;
      console.log(`[onnx-pipeline] Reranker model ${_status.rerankModel} loaded in ${Date.now() - t0}ms`);
      return { tokenizer: _rerankTokenizer, model: _rerankModel };
    } catch (e) {
      _status.lastError = `rerank_load_failed: ${e?.message || e}`;
      console.error("[onnx-pipeline] Failed to load ONNX reranker model:", e);
      throw e;
    } finally {
      _rerankLoadingPromise = null;
    }
  })();

  return _rerankLoadingPromise;
}

/**
 * In-Process ONNX Embedding calculation
 * @param {string|string[]} texts
 * @param {object} [opts]
 * @returns {Promise<number[][]>}
 */
export async function onnxEmbed(texts, opts = {}) {
  const rawList = Array.isArray(texts) ? texts : [texts];
  const inputList = rawList.map((t) => (t != null ? String(t).trim() : "")).filter(Boolean);
  if (inputList.length === 0) return [];

  const pipe = await getEmbedPipeline();
  const t0 = Date.now();
  const results = [];
  const batchSize = Math.max(1, Math.min(64, Number(opts.batchSize) || 32));

  for (let i = 0; i < inputList.length; i += batchSize) {
    const batch = inputList.slice(i, i + batchSize);
    
    // BAAI/bge models standard: pooling="cls", normalize=true (384-dim unit vector)
    const out = await pipe(batch, {
      pooling: "cls",
      normalize: true,
    });

    // Handle single tensor vs batch dims
    if (batch.length === 1) {
      results.push(Array.from(out.data));
    } else {
      const dim = 384;
      const raw = Array.from(out.data);
      for (let j = 0; j < batch.length; j++) {
        results.push(raw.slice(j * dim, (j + 1) * dim));
      }
    }

    // Yield control to event loop to prevent event-loop starvation during heavy ingestion
    if (i + batchSize < inputList.length) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  _status.lastEmbedMs = Date.now() - t0;
  return results;
}

/**
 * In-Process ONNX Reranking calculation
 * @param {string} query
 * @param {string[]} documents
 * @param {object} [opts]
 * @returns {Promise<Array<{ index: number, score: number }>>}
 */
export async function onnxRerank(query, documents, opts = {}) {
  const qClean = String(query || "").trim();
  if (!qClean || !Array.isArray(documents) || documents.length === 0) return [];
  
  const validDocs = documents.map((d) => String(d || "").slice(0, 2000).trim());
  const { tokenizer, model } = await getRerankPipeline();

  const t0 = Date.now();
  const queries = validDocs.map(() => qClean);
  
  const inputs = tokenizer(queries, {
    text_pair: validDocs,
    padding: true,
    truncation: true,
    max_length: 512,
  });

  const { logits } = await model(inputs);
  const rawScores = Array.from(logits.data);

  // Convert raw cross-entropy logits to sigmoid probabilities: 1 / (1 + exp(-s))
  let scored = rawScores.map((s, index) => ({
    index,
    score: 1 / (1 + Math.exp(-s)),
  }));

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  if (opts.topN && opts.topN > 0) {
    scored = scored.slice(0, Number(opts.topN));
  }

  _status.lastRerankMs = Date.now() - t0;
  return scored;
}

export function getOnnxStatus() {
  return { ..._status };
}
