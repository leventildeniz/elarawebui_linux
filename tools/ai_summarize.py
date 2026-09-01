#!/usr/bin/env python3
# @tool: ai_summarize
# @description: ELARA MLX gateway üzerinden lokal model ile özet çıkarır.
"""SYS tool · ai.summarize — local-model summarisation via the ELARA MLX gateway.

Contract:
  argv[1] = JSON { "input": str, "max_words": int, "model": str? } OR plain text.
  Env: ELARA_MLX_URL (default http://127.0.0.1:8089/v1/chat/completions),
       ELARA_MLX_MODEL (fallback model id when params.model is empty).

Output: JSON { ok, summary, model, tokens? }
"""
import os, sys, json, urllib.request, urllib.error

def parse_args():
    if len(sys.argv) < 2: return {"input": ""}
    raw = sys.argv[1]
    if raw and raw.lstrip().startswith("{"):
        try: return json.loads(raw)
        except Exception: pass
    return {"input": raw}

def main():
    p = parse_args()
    text = str(p.get("input") or p.get("text") or "").strip()
    if not text:
        print(json.dumps({"ok": False, "error": "empty_input"})); return
    max_words = max(10, min(400, int(p.get("max_words") or 80)))
    url   = os.environ.get("ELARA_MLX_URL", "http://127.0.0.1:8089/v1/chat/completions")
    model = str(p.get("model") or os.environ.get("ELARA_MLX_MODEL", "elara-mlx"))

    sys_msg = (f"/no_think You are a precise summariser. Output ONE paragraph "
               f"of at most {max_words} words. No preamble, no bullets, no thinking.")
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": sys_msg},
                     {"role": "user", "content": text[:16000]}],
        "temperature": 0.2, "max_tokens": max(64, max_words * 4),
        "chat_template_kwargs": {"enable_thinking": False},
    }
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace"))
        choice = (data.get("choices") or [{}])[0]
        summary = (choice.get("message") or {}).get("content") or choice.get("text") or ""
        summary = summary.strip()
        usage = data.get("usage") or {}
        print(json.dumps({"ok": True, "summary": summary, "model": data.get("model") or model,
                          "tokens": usage.get("completion_tokens")}))
    except urllib.error.URLError as e:
        print(json.dumps({"ok": False, "error": "mlx_unreachable", "url": url, "detail": str(e)}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": "summarize_failed", "detail": str(e)}))

if __name__ == "__main__":
    main()
