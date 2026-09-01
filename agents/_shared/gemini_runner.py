# agents/_shared/gemini_runner.py
# Google Gemini path (researcher.py kullanıyor).
# API key SADECE env'den (GEMINI_API_KEY), kodda hardcoded yok.
import sys
import time

from . import config_center as cfg


def stream_search(query: str) -> None:
    if not cfg.GEMINI_API_KEY:
        sys.stderr.write("[gemini_runner] GEMINI_API_KEY env yok\n")
        print("⚠️ Gemini damarı kapalı Mimar: GEMINI_API_KEY env eksik.", flush=True)
        return
    try:
        from google import genai
        from google.genai import types
    except Exception as e:
        sys.stderr.write(f"[gemini_runner] import failed: {e}\n")
        print(f"⚠️ google-genai paketi yüklü değil: {e}", flush=True)
        return

    client = genai.Client(api_key=cfg.GEMINI_API_KEY)
    sys_prompt = cfg.effective_system_prompt()
    full_prompt = f"{sys_prompt}\n\nSorgu: {query}"

    t0 = time.time()
    ttft_ms = None
    try:
        stream = client.models.generate_content_stream(
            model=cfg.GEMINI_MODEL,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=cfg.AGENT_TEMPERATURE,
                max_output_tokens=cfg.AGENT_MAX_TOKENS,
            ),
            contents=full_prompt,
        )
        for chunk in stream:
            text = getattr(chunk, "text", "") or ""
            if not text:
                continue
            if ttft_ms is None:
                ttft_ms = int((time.time() - t0) * 1000)
                sys.stderr.write(f"[gemini_runner] ttft_ms={ttft_ms}\n")
            print(text, end="", flush=True)
        print("", flush=True)
        sys.stderr.write(f"[gemini_runner] done total_ms={int((time.time()-t0)*1000)}\n")
    except Exception as e:
        sys.stderr.write(f"[gemini_runner] stream error: {e}\n")
        print(f"\n⚠️ Gemini istihbarat damarı kesildi: {e}", flush=True)


def run_agent(payload: str) -> None:
    if not payload or not payload.strip():
        print("⚠️ Dispatch failed: empty payload — no order reached the agent.", flush=True)
        return
    stream_search(payload)
