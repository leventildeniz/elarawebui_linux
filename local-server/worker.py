#!/usr/bin/env python3
"""
ELARA Sovereign Vector Worker — Port 8082
High-performance, pure FastAPI + PyTorch sentence-transformers worker.
Provides standard /v1/embeddings, /v1/rerank, and /health endpoints.
"""
from __future__ import annotations

import gc
import logging
import os
import sys
import threading
import time
from typing import List, Union

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="[worker] %(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("worker")

MODEL_NAME = os.environ.get("EMBED_MODEL", "BAAI/bge-small-en-v1.5").strip().strip('"').strip("'")
RERANK_MODEL_NAME = os.environ.get("RAG_RERANK_MODEL", "BAAI/bge-reranker-base").strip().strip('"').strip("'")
DEVICE_PREF = os.environ.get("EMBED_DEVICE", "auto").lower()

backend = None
backend_name = "none"
encode_fn = None
DIM = 384
REQ_COUNT = 0
START_TS = time.time()

_rerank_model = None
_rerank_lock = threading.Lock()
_rerank_last_ms = 0
_rerank_load_err = None


def _get_rss_gb() -> float:
    try:
        import psutil
        return round(psutil.Process().memory_info().rss / (1024 ** 3), 3)
    except Exception:
        return 0.0


def _load_embed_backend() -> bool:
    global backend, backend_name, encode_fn, DIM
    # 1. Try MLX (Apple Silicon) if available
    if DEVICE_PREF in ("auto", "mlx"):
        try:
            from mlx_embeddings.utils import load  # type: ignore
            import mlx.core as mx  # type: ignore
            log.info("Loading via mlx_embeddings: %s", MODEL_NAME)
            model, tokenizer = load(MODEL_NAME)
            backend = (model, tokenizer)
            backend_name = "mlx_embeddings"

            def _encode_mlx(texts: List[str]) -> List[List[float]]:
                out = []
                for t in texts:
                    enc = tokenizer.encode(t, return_tensors="mlx")
                    res = model(enc)
                    vec = res.text_embeds[0] if hasattr(res, "text_embeds") else res[0]
                    mx.eval(vec)
                    out.append([float(x) for x in vec.tolist()])
                return out

            encode_fn = _encode_mlx
            DIM = len(encode_fn(["probe"])[0])
            log.info("MLX backend ready · dim=%d", DIM)
            return True
        except Exception:
            pass

    # 2. PyTorch sentence-transformers (Linux / CPU / MPS)
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        import torch  # type: ignore

        threads = min(4, max(1, os.cpu_count() or 4))
        torch.set_num_threads(threads)

        device = "cpu"
        if DEVICE_PREF in ("auto", "mps"):
            try:
                if torch.backends.mps.is_available():
                    device = "mps"
            except Exception:
                pass

        log.info("Loading sentence_transformers: %s on %s (threads=%d)", MODEL_NAME, device, threads)
        model = SentenceTransformer(MODEL_NAME, device=device)
        model.eval()
        backend = model
        backend_name = f"sentence_transformers:{device}"

        def _encode_torch(texts: List[str]) -> List[List[float]]:
            with torch.inference_mode():
                arr = model.encode(
                    texts,
                    batch_size=64,
                    normalize_embeddings=True,
                    convert_to_numpy=True,
                    show_progress_bar=False,
                )
                return [vec.tolist() for vec in arr]

        encode_fn = _encode_torch
        DIM = len(encode_fn(["probe"])[0])
        log.info("SentenceTransformers backend ready · dim=%d", DIM)
        return True
    except Exception as e:
        log.error("Failed to load sentence_transformers: %s", e)
        return False


def _load_reranker() -> bool:
    global _rerank_model, _rerank_load_err
    if _rerank_model is not None:
        return True
    with _rerank_lock:
        if _rerank_model is not None:
            return True
        try:
            from sentence_transformers import CrossEncoder  # type: ignore
            device = "cpu"
            if DEVICE_PREF in ("auto", "mps"):
                try:
                    import torch  # type: ignore
                    if torch.backends.mps.is_available():
                        device = "mps"
                except Exception:
                    pass
            log.info("Loading CrossEncoder reranker: %s on %s", RERANK_MODEL_NAME, device)
            _rerank_model = CrossEncoder(RERANK_MODEL_NAME, device=device, max_length=512)
            _rerank_load_err = None
            log.info("Reranker ready · model=%s", RERANK_MODEL_NAME)
            return True
        except Exception as e:
            _rerank_load_err = f"{type(e).__name__}: {e}"
            log.warning("Reranker load failed: %s", _rerank_load_err)
            return False


app = FastAPI(title="ELARA Sovereign Vector Worker", version="2.0")


@app.on_event("startup")
def startup_event():
    if not _load_embed_backend():
        log.error("FATAL: No embedding backend could be initialized.")


class EmbedReq(BaseModel):
    model: str | None = None
    input: Union[str, List[str]]


class RerankReq(BaseModel):
    model: str | None = None
    query: str
    documents: List[str]
    top_n: int | None = None


@app.get("/health")
def health():
    rss = _get_rss_gb()
    return {
        "ok": encode_fn is not None,
        "model": MODEL_NAME,
        "backend": backend_name,
        "dim": DIM,
        "uptime_s": int(time.time() - START_TS),
        "rss_gb": rss,
        "footprint_gb": rss,
        "max_rss_gb": 8.0,
        "soft_cap_gb": 6.0,
        "req_count": REQ_COUNT,
        "max_requests": 50000,
        "reranker": {
            "loaded": _rerank_model is not None,
            "warmed": _rerank_model is not None,
            "model": RERANK_MODEL_NAME,
            "max_rss_gb": 4.0,
            "last_ms": _rerank_last_ms,
            "last_error": _rerank_load_err,
        },
    }


@app.post("/v1/embeddings")
def embeddings(req: EmbedReq):
    global REQ_COUNT
    texts = req.input if isinstance(req.input, list) else [req.input]
    if not texts:
        raise HTTPException(status_code=400, detail="input required")
    if encode_fn is None:
        raise HTTPException(status_code=503, detail="embedding backend not ready")

    t0 = time.time()
    try:
        vecs = encode_fn(texts)
    except Exception as e:
        log.exception("Embedding computation error")
        raise HTTPException(status_code=500, detail=str(e))

    dt_ms = int((time.time() - t0) * 1000)
    REQ_COUNT += 1

    return {
        "object": "list",
        "model": req.model or MODEL_NAME,
        "data": [
            {"object": "embedding", "index": i, "embedding": v}
            for i, v in enumerate(vecs)
        ],
        "usage": {"prompt_tokens": sum(len(t) for t in texts), "total_tokens": 0},
    }


@app.post("/v1/rerank")
def rerank(req: RerankReq):
    global _rerank_last_ms
    q = (req.query or "").strip()
    docs = req.documents or []
    if not q or not docs:
        raise HTTPException(status_code=400, detail="query and documents required")
    if not _load_reranker():
        raise HTTPException(status_code=503, detail=f"reranker unavailable: {_rerank_load_err}")

    t0 = time.time()
    try:
        pairs = [(q, d) for d in docs]
        scores = _rerank_model.predict(pairs, convert_to_numpy=True, show_progress_bar=False)
    except Exception as e:
        log.exception("Rerank error")
        raise HTTPException(status_code=500, detail=str(e))

    dt_ms = int((time.time() - t0) * 1000)
    _rerank_last_ms = dt_ms

    ranked = sorted(
        [{"index": i, "score": float(s)} for i, s in enumerate(scores)],
        key=lambda x: x["score"],
        reverse=True,
    )
    if req.top_n and req.top_n > 0:
        ranked = ranked[: int(req.top_n)]

    return {
        "object": "list",
        "model": req.model or RERANK_MODEL_NAME,
        "data": ranked,
        "ms": dt_ms,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("EMBED_WORKER_PORT", 8082)))
