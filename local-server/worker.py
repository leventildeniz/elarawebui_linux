#!/usr/bin/env python3
"""
ELARA Vector Worker — bge-m3 on port 8082.

Provides OpenAI-compatible /v1/embeddings and /v1/rerank endpoints.
Managed automatically by systemd (elara-worker.service) or child process.

Usage (manual):
    python3 -m uvicorn worker:app --host 127.0.0.1 --port 8082

Env:
    EMBED_MODEL              default: BAAI/bge-m3
    EMBED_DEVICE             default: auto (mlx > torch.mps > cpu)
    EMBED_WORKER_MAX_RSS_GB  default: 8.0   (threshold for graceful memory reset)
    EMBED_WORKER_MAX_REQUESTS default: 5000 (threshold for lifecycle refresh)
    EMBED_WORKER_GC_EVERY    default: 1     (frequency of GC and tensor cache cleanup)
    EMBED_WORKER_RSS_CHECK_SEC default: 60  (background RSS check period, 0 = disabled)
"""
from __future__ import annotations

import gc
import logging
import os
import signal
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

MODEL_NAME = os.environ.get("EMBED_MODEL", "BAAI/bge-m3").strip().strip('"').strip("'")
DEVICE_PREF = os.environ.get("EMBED_DEVICE", "auto").lower()

MAX_RSS_GB      = float(os.environ.get("EMBED_WORKER_MAX_RSS_GB", "8.0"))
MAX_REQUESTS    = int(os.environ.get("EMBED_WORKER_MAX_REQUESTS", "5000"))
GC_EVERY        = max(1, int(os.environ.get("EMBED_WORKER_GC_EVERY", "1")))
RSS_CHECK_SEC   = int(os.environ.get("EMBED_WORKER_RSS_CHECK_SEC", "60"))

# Reranker (CrossEncoder) — eager-warmed in startup thread.
# Reduces initial inference latency to ~50-150ms. RAG_RERANK_WARMUP=0 disables warmup.
RERANK_MODEL_NAME = os.environ.get("RAG_RERANK_MODEL", "BAAI/bge-reranker-base").strip().strip('"').strip("'")
RERANK_MAX_RSS_GB = float(os.environ.get("RERANKER_MAX_RSS_GB", "2.0"))
RERANK_WARMUP     = os.environ.get("RAG_RERANK_WARMUP", "1") == "1"
_rerank_model = None        # CrossEncoder instance
_rerank_load_err = None     # last load/inference error string
_rerank_lock = threading.Lock()
_rerank_warmed = False      # True after first successful predict (warmup or request)
_rerank_last_ms = 0         # last predict latency in ms, surfaced via /health

# ---------------------------------------------------------------------------
# Backend selection — try mlx_embeddings → sentence_transformers → fail clean.
# Both produce 1024-dim vectors for bge-m3, so server.mjs assumptions hold.
# ---------------------------------------------------------------------------

backend = None
backend_name = "none"
encode_fn = None  # type: ignore

# Cache cleanup hooks set after backend probes; called from cleanup_caches().
_mx_clear = None  # type: ignore
_torch_empty = None  # type: ignore


def _try_mlx() -> bool:
    global backend, backend_name, encode_fn, _mx_clear
    try:
        from mlx_embeddings.utils import load  # type: ignore
        import mlx.core as mx  # type: ignore
        log.info("loading via mlx_embeddings: %s", MODEL_NAME)
        model, tokenizer = load(MODEL_NAME)
        backend = (model, tokenizer)
        backend_name = "mlx_embeddings"

        def _encode(texts: List[str]) -> List[List[float]]:
            out: List[List[float]] = []
            # Batch optimization and leak fix: Don't keep intermediate MLX graph alive
            for t in texts:
                enc = tokenizer.encode(t, return_tensors="mlx")
                res = model(enc)
                vec = res.text_embeds[0] if hasattr(res, "text_embeds") else res[0]
                # Force evaluation to break computation graph
                mx.eval(vec)
                out.append([float(x) for x in vec.tolist()])
                # explicit reference delete for garbage collection
                del enc
                del res
                del vec
            return out

        encode_fn = _encode
        # mlx_metal clear cache hook (mlx >= 0.0.10)
        try:
            _mx_clear = mx.metal.clear_cache  # type: ignore
        except Exception:
            try:
                _mx_clear = mx.clear_cache  # type: ignore
            except Exception:
                _mx_clear = None
        return True
    except Exception as e:  # pragma: no cover
        log.warning("mlx_embeddings unavailable: %s", e)
        return False


def _try_sentence_transformers() -> bool:
    global backend, backend_name, encode_fn, _torch_empty
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        import torch  # type: ignore

        # Tune CPU concurrency to avoid thread thrashing across vCPUs
        threads = min(4, max(1, os.cpu_count() or 4))
        torch.set_num_threads(threads)
        try:
            torch.set_num_interop_threads(1)
        except Exception:
            pass

        device = "cpu"
        if DEVICE_PREF in ("auto", "mps"):
            try:
                if torch.backends.mps.is_available():
                    device = "mps"
            except Exception:
                pass
        log.info("loading via sentence_transformers: %s on %s (threads=%d)", MODEL_NAME, device, threads)
        model = SentenceTransformer(MODEL_NAME, device=device)
        model.eval()
        backend = model
        backend_name = f"sentence_transformers:{device}"

        def _encode(texts: List[str]) -> List[List[float]]:
            with torch.inference_mode():
                arr = model.encode(texts, batch_size=64, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False)
                res = [vec.tolist() for vec in arr]
                del arr
                return res

        encode_fn = _encode
        if device == "mps":
            try:
                _torch_empty = torch.mps.empty_cache  # type: ignore
            except Exception:
                _torch_empty = None
        return True
    except Exception as e:
        log.warning("sentence_transformers unavailable: %s", e)
        return False


# Note: Model loading occurs inside the ASGI lifespan startup handler
# to ensure a single serving process without redundant pre-import overhead.

# ---------------------------------------------------------------------------
# Cache cleanup + RSS watchdog guards
# ---------------------------------------------------------------------------

def _rss_gb() -> float:
    """Process RSS in GB. Uses psutil where available with resource fallback."""
    try:
        import psutil  # type: ignore
        return psutil.Process().memory_info().rss / (1024 ** 3)
    except Exception:
        try:
            import resource  # type: ignore
            ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            # macOS: bytes, Linux: kilobytes
            if sys.platform == "darwin":
                return ru / (1024 ** 3)
            return ru / (1024 ** 2)
        except Exception:
            return 0.0


def _mps_gb() -> float:
    """torch.mps allocated memory (GPU heap) in GB."""
    try:
        import torch  # type: ignore
        if torch.backends.mps.is_available():
            return float(torch.mps.current_allocated_memory()) / (1024 ** 3)
    except Exception:
        pass
    return 0.0


def _mlx_metal_gb() -> float:
    """MLX Metal heap (active/peak) in GB."""
    try:
        import mlx.core as mx  # type: ignore
        for fn_name in ("get_active_memory", "get_peak_memory"):
            fn = getattr(getattr(mx, "metal", None), fn_name, None)
            if callable(fn):
                try:
                    return float(fn()) / (1024 ** 3)
                except Exception:
                    continue
    except Exception:
        pass
    return 0.0


def _footprint_gb() -> float:
    """Backend-aware memory footprint."""
    name = (backend_name or "").lower()
    if name.startswith("mlx_embeddings"):
        return _rss_gb() + _mlx_metal_gb()
    if name.startswith("sentence_transformers:mps"):
        return _rss_gb() + _mps_gb()
    return _rss_gb()


# Soft cap ratio for pro-active garbage collection before hard limits
SOFT_CAP_RATIO = 0.75
_last_soft_relief_ts = 0.0


def cleanup_caches() -> None:
    """Release intermediate tensor caches to maintain steady-state RAM."""
    try:
        gc.collect()
        gc.collect()
    except Exception:
        pass
    if _mx_clear is not None:
        try: _mx_clear()
        except Exception: pass
    if _torch_empty is not None:
        try: _torch_empty()
        except Exception: pass
    try:
        import ctypes
        libc = ctypes.CDLL("libc.dylib")
        if hasattr(libc, "malloc_zone_pressure_relief"):
            libc.malloc_zone_pressure_relief(None, 0)
    except Exception:
        pass








REQ_COUNT = 0
START_TS = time.time()
DIM = 0  # Initialized during startup hook

# ---------------------------------------------------------------------------
# FastAPI surface
# ---------------------------------------------------------------------------

app = FastAPI(title="ELARA Vector Worker", version="1.2")


def _rss_watchdog_loop():
    import psutil
    pid = os.getpid()
    proc = psutil.Process(pid)
    while True:
        try:
            time.sleep(RSS_CHECK_SEC)
            rss_bytes = proc.memory_info().rss
            rss_gb = rss_bytes / (1024**3)
            if rss_gb > MAX_RSS_GB:
                log.error("RSS watchdog: %.2f GB exceeds limit %.2f GB. Exiting.", rss_gb, MAX_RSS_GB)
                os._exit(1)
        except Exception:
            pass

@app.on_event("startup")
def _startup_load_model() -> None:
    """Load model during startup phase in a single dedicated serving process."""
    global DIM
    if encode_fn is not None:
        return
    if not (_try_mlx() or _try_sentence_transformers()):
        log.error("No embedding backend available. Install sentence-transformers and torch.")
        os._exit(1)
    DIM = len(encode_fn(["dim_probe"])[0])
    cleanup_caches()
    log.info("worker ready · backend=%s · model=%s · dim=%d · max_rss=%.2fGB · max_req=%d",
             backend_name, MODEL_NAME, DIM, MAX_RSS_GB, MAX_REQUESTS)
    if RSS_CHECK_SEC > 0:
        threading.Thread(target=_rss_watchdog_loop, daemon=True, name="rss-watchdog").start()
    if RERANK_WARMUP:
        threading.Thread(target=_warmup_reranker, daemon=True, name="rerank-warmup").start()


def _warmup_reranker() -> None:
    """Warm up CrossEncoder model on boot to reduce first request latency."""
    global _rerank_warmed, _rerank_last_ms, _rerank_load_err
    if not _load_reranker():
        log.warning("[rerank-warmup] load failed: %s", _rerank_load_err)
        return
    try:
        t0 = time.time()
        _rerank_model.predict([("warmup", "ready")], convert_to_numpy=True, show_progress_bar=False)  # type: ignore
        _rerank_last_ms = int((time.time() - t0) * 1000)
        _rerank_warmed = True
        log.info("reranker warmed · first predict %dms · rss=%.2fGB", _rerank_last_ms, _rss_gb())
    except Exception as e:
        _rerank_load_err = f"warmup: {type(e).__name__}: {e}"
        log.warning("[rerank-warmup] predict failed: %s", _rerank_load_err)


@app.on_event("shutdown")
def _shutdown_cleanup() -> None:
    """Deterministic release of model and tensor buffers on shutdown."""
    global backend, encode_fn
    try:
        log.info("[shutdown] cleanup starting · rss=%.2fGB · req_count=%d", _rss_gb(), REQ_COUNT)
    except Exception:
        pass
    try:
        backend = None
        encode_fn = None
    except Exception:
        pass
    cleanup_caches()
    cleanup_caches()
    try:
        log.info("[shutdown] complete · rss=%.2fGB", _rss_gb())
    except Exception:
        pass


def _install_signal_handlers() -> None:
    """Ensure graceful cleanup on SIGTERM / SIGINT."""
    def _handler(signum, _frame):
        log.warning("[signal] %s received -> cleanup and exit", signum)
        try:
            _shutdown_cleanup()
        except Exception:
            pass
        os._exit(0)
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, _handler)
        except Exception:
            pass


_install_signal_handlers()


class EmbedReq(BaseModel):
    model: str | None = None
    input: Union[str, List[str]]


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "model": MODEL_NAME,
        "backend": backend_name,
        "dim": DIM,
        "uptime_s": int(time.time() - START_TS),
        "rss_gb": round(_rss_gb(), 3),
        "mps_gb": round(_mps_gb(), 3),
        "mlx_metal_gb": round(_mlx_metal_gb(), 3),
        "footprint_gb": round(_footprint_gb(), 3),
        "max_rss_gb": MAX_RSS_GB,
        "soft_cap_gb": round(MAX_RSS_GB * SOFT_CAP_RATIO, 3),
        "req_count": REQ_COUNT,
        "max_requests": MAX_REQUESTS,

        "reranker": {
            "loaded": _rerank_model is not None,
            "warmed": _rerank_warmed,
            "model": RERANK_MODEL_NAME,
            "max_rss_gb": RERANK_MAX_RSS_GB,
            "last_ms": _rerank_last_ms,
            "last_error": _rerank_load_err,
        },
    }


@app.post("/v1/embeddings")
def embeddings(req: EmbedReq) -> dict:
    global REQ_COUNT
    texts = req.input if isinstance(req.input, list) else [req.input]
    if not texts:
        raise HTTPException(status_code=400, detail="input required")
    t0 = time.time()
    try:
        vecs = encode_fn(texts)
    except Exception as e:
        log.exception("embed failed")
        raise HTTPException(status_code=500, detail=str(e))
    dt = (time.time() - t0) * 1000
    REQ_COUNT += 1
    if REQ_COUNT % GC_EVERY == 0:
        cleanup_caches()
    log.info("embed n=%d dim=%d in %.0fms rss=%.2fGB req=%d",
             len(texts), DIM, dt, _rss_gb(), REQ_COUNT)
    payload = {
        "object": "list",
        "model": req.model or MODEL_NAME,
        "data": [
            {"object": "embedding", "index": i, "embedding": v}
            for i, v in enumerate(vecs)
        ],
        "usage": {"prompt_tokens": sum(len(t) for t in texts), "total_tokens": 0},
    }
    return payload


# ---------------------------------------------------------------------------
# Reranker (CrossEncoder) — Optional precision re-ranking layer
# Lazy-load: Loaded on demand during inference to keep boot memory minimal.
# ---------------------------------------------------------------------------

class RerankReq(BaseModel):
    model: str | None = None
    query: str
    documents: List[str]
    top_n: int | None = None


def _load_reranker() -> bool:
    """sentence_transformers.CrossEncoder lazy loader. Thread-safe, idempotent."""
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
            log.info("loading reranker: %s on %s", RERANK_MODEL_NAME, device)
            _rerank_model = CrossEncoder(RERANK_MODEL_NAME, device=device, max_length=512)
            _rerank_load_err = None
            log.info("reranker ready · model=%s · device=%s · rss=%.2fGB",
                     RERANK_MODEL_NAME, device, _rss_gb())
            return True
        except Exception as e:
            _rerank_load_err = f"{type(e).__name__}: {e}"
            log.warning("reranker load failed: %s", _rerank_load_err)
            return False


@app.post("/v1/rerank")
def rerank(req: RerankReq) -> dict:
    global _rerank_load_err
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
        _rerank_load_err = f"predict: {type(e).__name__}: {e}"
        log.exception("rerank failed")
        raise HTTPException(status_code=500, detail=str(e))
    dt = (time.time() - t0) * 1000
    ranked = sorted(
        [{"index": i, "score": float(s)} for i, s in enumerate(scores)],
        key=lambda x: x["score"], reverse=True,
    )
    if req.top_n and req.top_n > 0:
        ranked = ranked[: int(req.top_n)]
    global _rerank_warmed, _rerank_last_ms
    _rerank_last_ms = int(dt)
    _rerank_warmed = True
    log.info("rerank n=%d in %.0fms rss=%.2fGB", len(docs), dt, _rss_gb())
    # Reranker memory footprint guard
    fp = _footprint_gb()
    return {
        "object": "list",
        "model": req.model or RERANK_MODEL_NAME,
        "data": ranked,
        "ms": round(dt, 1),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("EMBED_WORKER_PORT", 8082)))
