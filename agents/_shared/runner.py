# agents/_shared/runner.py
# MLX server üzerinden OpenAI-compat streaming çağrı.
# - stream=True + flush'lu stdout → TTFT 1-3s
# - max_tokens DB profile'dan (env üzerinden gelir)
# - httpx timeout sertleştirildi (sonsuz hang yok)
# - OpenAI import LAZY (cold-start ~1s düşer)
# - Model auto-fallback: configured slug MLX'te yoksa /v1/models ilk slug'ı kullanılır
# - Error sterilizasyonu: MLX 404 / HF snapshot mesajları İngilizce tek-satır hâline getirilir
import json
import os
import re
import sys
import time


from . import config_center as cfg


_MODEL_CACHE: list[str] | None = None


def _build_client():
    # Lazy import — cold start kıyımı için
    import httpx
    from openai import OpenAI

    timeout = httpx.Timeout(
        connect=cfg.HTTP_CONNECT_TIMEOUT,
        read=cfg.HTTP_READ_TIMEOUT,
        write=cfg.HTTP_WRITE_TIMEOUT,
        pool=cfg.HTTP_POOL_TIMEOUT,
    )
    http_client = httpx.Client(timeout=timeout)
    return OpenAI(
        base_url=cfg.MLX_BASE_URL,
        api_key="needed-but-ignored-by-mlx",
        http_client=http_client,
    )


def _list_models(client) -> list[str]:
    """MLX /v1/models — cache'li. Sentinel veya boş model resolve'unda kullanılır."""
    global _MODEL_CACHE
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE
    try:
        resp = client.models.list()
        ids = [m.id for m in getattr(resp, "data", []) if getattr(m, "id", None)]
        _MODEL_CACHE = ids
    except Exception as e:
        sys.stderr.write(f"[runner] models.list failed: {e}\n")
        _MODEL_CACHE = []
    return _MODEL_CACHE


def _resolve_model(client, requested: str) -> str:
    """İstenen model id'sini MLX'in canlı yüklü model listesine doğrula.

    mlx_lm.server bazen iki id yayınlar: HF-tarzı repo adı (çoğu zaman
    phantom/eski) + `--model` argümanından gelen absolute path. Agent
    meta'sındaki id canlı listede birebir yoksa MLX 404 atar (HF_HUB_OFFLINE
    iken indiremez). Bu yüzden:
      - sentinel istek (boş/default_model/auto) → path-like > ilk id
      - non-sentinel istek listede VARSA aynen geçer
      - non-sentinel istek listede YOKSA path-like'a coerce, yoksa ilk id'ye düşer
    Liste alınamazsa ham requested geri verilir.
    """
    req = (requested or "").strip()
    loaded = _list_models(client)
    if not loaded:
        return req or "default_model"
    sentinel = req in ("", "default_model", "auto")
    path_like = next((m for m in loaded if isinstance(m, str) and m.startswith("/")), None)
    if sentinel:
        chosen = path_like or loaded[0]
        sys.stderr.write(f"[runner] model auto-resolved → {chosen} (candidates={loaded})\n")
        return chosen
    if req in loaded:
        return req
    chosen = path_like or loaded[0]
    sys.stderr.write(f"[runner] model coerced: requested={req} → chosen={chosen} (loaded={loaded})\n")
    return chosen


_HF_OFFLINE_RE = re.compile(
    r"Cannot find an appropriate cached snapshot.*?HF_HUB_OFFLINE",
    re.IGNORECASE | re.DOTALL,
)


def _sterilize_error(err: Exception, model: str, loaded: list[str] | None = None) -> str:
    """MLX'ten gelen HF snapshot 404 body'sini kısa İngilizce mesaja indir."""
    msg = str(err)
    et = type(err).__name__
    is_404 = (
        "Error code: 404" in msg
        or " 404 " in msg
        or "not found" in msg.lower()
        or et in ("NotFoundError", "HTTPStatusError")
    )
    if _HF_OFFLINE_RE.search(msg) or "snapshot folder" in msg.lower():
        return f"Model not loaded on MLX runtime: {model!r}. Cached snapshot missing — check the slug or load the model."
    if is_404:
        hint = ""
        if loaded:
            hint = f" Loaded slugs: {loaded[:3]}"
        return f"MLX runtime returned 404 for model {model!r}.{hint} Verify the model slug or restart MLX."
    if "ReadTimeout" in msg or "ConnectError" in msg or "ConnectionRefused" in msg or "ConnectTimeout" in msg:
        return f"MLX runtime unreachable: {et}. Check 8001 and `Restart MLX` from the UI."
    short = msg.replace("\n", " ").strip()
    if len(short) > 200:
        short = short[:200] + "…"
    return f"MLX stream error: {short}"


# =============================================================================
# Chat template registry — MIRROR of local-server/lib/chat-templates.mjs.
# Tek mercii JS tarafında; bu sözlük her aile için birebir karşılığı tutar.
# Sessiz fallback YASAK (2026-06-02): bilinmeyen family → RuntimeError fırlatır,
# agent run patlar, watchdog yakalar. Yeni aile eklendiğinde JS + bu dosya +
# scripts/smoke-chat-templates.sh aynı turda güncellenir.
# =============================================================================


def _render_qwen(msgs: list[dict]) -> tuple[str, list[str]]:
    s = "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in msgs)
    s += "<|im_start|>assistant\n"
    return s, ["<|im_end|>", "<|endoftext|>", "<|im_start|>"]


def _render_llama3(msgs: list[dict]) -> tuple[str, list[str]]:
    s = "<|begin_of_text|>"
    s += "".join(f"<|start_header_id|>{m['role']}<|end_header_id|>\n\n{m['content']}<|eot_id|>" for m in msgs)
    s += "<|start_header_id|>assistant<|end_header_id|>\n\n"
    return s, ["<|eot_id|>", "<|end_of_text|>", "<|start_header_id|>"]


def _render_mistral(msgs: list[dict]) -> tuple[str, list[str]]:
    s = "<s>"
    pending_system = ""
    open_inst = False
    for m in msgs:
        role = m.get("role")
        content = m.get("content") or ""
        if role == "system":
            pending_system = f"{pending_system}\n\n{content}" if pending_system else content
            continue
        if role == "user":
            user_text = f"{pending_system}\n\n{content}" if pending_system else content
            pending_system = ""
            s += f"[INST] {user_text} [/INST]"
            open_inst = True
        elif role == "assistant":
            s += f" {content}</s>"
            open_inst = False
    if not open_inst and pending_system:
        s += f"[INST] {pending_system} [/INST]"
    return s, ["</s>", "[INST]"]


def _render_gemma(msgs: list[dict]) -> tuple[str, list[str]]:
    """Gemma 2/3 — no system role; merged into first user turn."""
    s = ""
    pending_system = ""
    open_user = False
    for m in msgs:
        role = m.get("role")
        content = m.get("content") or ""
        if role == "system":
            pending_system = f"{pending_system}\n\n{content}" if pending_system else content
            continue
        if role == "user":
            user_text = f"{pending_system}\n\n{content}" if pending_system else content
            pending_system = ""
            s += f"<start_of_turn>user\n{user_text}<end_of_turn>\n"
            open_user = True
        elif role == "assistant":
            s += f"<start_of_turn>model\n{content}<end_of_turn>\n"
            open_user = False
    if not open_user and pending_system:
        s += f"<start_of_turn>user\n{pending_system}<end_of_turn>\n"
    s += "<start_of_turn>model\n"
    return s, ["<end_of_turn>", "<eos>"]


def _render_deepseek(msgs: list[dict]) -> tuple[str, list[str]]:
    """DeepSeek V2/V3 native template. Unicode <｜...｜> tokens are single chars in the tokenizer."""
    s = "<\uff5cbegin\u2581of\u2581sentence\uff5c>"
    pending_system = ""
    for m in msgs:
        role = m.get("role")
        content = m.get("content") or ""
        if role == "system":
            pending_system = f"{pending_system}\n\n{content}" if pending_system else content
            continue
        if pending_system:
            s += pending_system
            pending_system = ""
        if role == "user":
            s += f"<\uff5cUser\uff5c>{content}"
        elif role == "assistant":
            s += f"<\uff5cAssistant\uff5c>{content}<\uff5cend\u2581of\u2581sentence\uff5c>"
    if pending_system:
        s += pending_system
    s += "<\uff5cAssistant\uff5c>"
    return s, ["<\uff5cend\u2581of\u2581sentence\uff5c>", "<\uff5cUser\uff5c>"]


def _render_phi(msgs: list[dict]) -> tuple[str, list[str]]:
    """Microsoft Phi-3 / 3.5 / 4."""
    s = ""
    for m in msgs:
        role = m.get("role")
        content = m.get("content") or ""
        if role == "system":
            s += f"<|system|>\n{content}<|end|>\n"
        elif role == "user":
            s += f"<|user|>\n{content}<|end|>\n"
        elif role == "assistant":
            s += f"<|assistant|>\n{content}<|end|>\n"
    s += "<|assistant|>\n"
    return s, ["<|end|>", "<|endoftext|>", "<|user|>"]


def _render_command_r(msgs: list[dict]) -> tuple[str, list[str]]:
    """Cohere Command-R / R+."""
    s = "<BOS_TOKEN>"
    for m in msgs:
        role = m.get("role")
        content = m.get("content") or ""
        if role == "system":
            tok = "SYSTEM_TOKEN"
        elif role == "user":
            tok = "USER_TOKEN"
        else:
            tok = "CHATBOT_TOKEN"
        s += f"<|START_OF_TURN_TOKEN|><|{tok}|>{content}<|END_OF_TURN_TOKEN|>"
    s += "<|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>"
    return s, ["<|END_OF_TURN_TOKEN|>", "<|START_OF_TURN_TOKEN|>"]


def _render_yi(msgs: list[dict]) -> tuple[str, list[str]]:
    """01.AI Yi-1.5 / Yi-Coder — ChatML-like with </s> stop."""
    s = "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in msgs)
    s += "<|im_start|>assistant\n"
    return s, ["<|im_end|>", "<|endoftext|>", "</s>"]


def _render_raw(msgs: list[dict]) -> tuple[str, list[str]]:
    s = "\n\n".join(f"[{m['role']}]\n{m['content']}" for m in msgs) + "\n\n[assistant]\n"
    return s, ["\n[user]", "\n[system]"]


def _gemma4_thinking_enabled() -> bool:
    """Read enable_thinking from ELARA_LLM_CHAT_TEMPLATE_KWARGS JSON.

    Default: False. Off-by-default per UI Switch contract — operator opens
    thinking explicitly via /models or agent editor Switch.
    """
    if os.getenv("ELARA_LLM_FORCE_DISABLE_THINKING", "").strip() == "1":
        return False
    try:
        raw = os.getenv("ELARA_LLM_CHAT_TEMPLATE_KWARGS") or ""
        if not raw.strip():
            return False
        obj = json.loads(raw)
        if isinstance(obj, dict) and "enable_thinking" in obj:
            return bool(obj.get("enable_thinking"))
    except Exception:
        pass
    return False



def _render_gemma4(msgs: list[dict]) -> tuple[str, list[str]]:
    """Google Gemma 4 — native <|turn> / <|channel> protocol.

    Mirrors chat_template.jinja shipped with google/gemma-4-* checkpoints.
    Assistant role -> 'model'. EOS = <eos> (id 1) + <turn|> (id 106) + <|tool_response> (id 50).
    """
    enable_thinking = _gemma4_thinking_enabled()
    s = "<bos>"
    system_text = ""
    rest = msgs
    if msgs and msgs[0].get("role") == "system":
        system_text = (msgs[0].get("content") or "").strip()
        rest = msgs[1:]
    if system_text or enable_thinking:
        s += "<|turn>system\n"
        if enable_thinking:
            s += "<|think|>\n"
        if system_text:
            s += system_text
        s += "<turn|>\n"
    for m in rest:
        role = m.get("role") or "user"
        if role == "assistant":
            role = "model"
        content = (m.get("content") or "")
        if role == "user":
            content = content.strip()
        s += f"<|turn>{role}\n{content}<turn|>\n"
    s += "<|turn>model\n"
    return s, ["<turn|>", "<eos>", "<|tool_response>"]


_CHAT_TEMPLATES = {
    "qwen2.5":   _render_qwen,
    "chatml":    _render_qwen,   # alias
    "llama3":    _render_llama3,
    "mistral":   _render_mistral,
    "gemma":     _render_gemma,
    "gemma4":    _render_gemma4,  # Google Gemma 4 — native <|turn>/<|channel> protocol
    "deepseek":  _render_deepseek,
    "phi":       _render_phi,
    "command-r": _render_command_r,
    "yi":        _render_yi,
    "raw":       _render_raw,
}


def _render_chat_prompt(messages: list[dict]) -> tuple[str, list[str]]:
    """Render chat prompt for /v1/completions. FAIL-LOUD on unknown family.

    Family resolution: env ELARA_LLM_TEMPLATE_FAMILY (per-agent, set by
    buildBrainEnv from the model row) → LLM_CHAT_TEMPLATE (boot env) → "qwen2.5".

    2026-06-02 — Sessiz qwen2.5 fallback KALDIRILDI. Bilinmeyen family =
    RuntimeError. Yeni aile eklemek = bu dosya + chat-templates.mjs + smoke.
    """
    family = (os.getenv("ELARA_LLM_TEMPLATE_FAMILY") or os.getenv("LLM_CHAT_TEMPLATE") or "qwen2.5").strip().lower()
    fn = _CHAT_TEMPLATES.get(family)
    if fn is None:
        known = ", ".join(sorted(_CHAT_TEMPLATES.keys()))
        raise RuntimeError(
            f"chat template family '{family}' not implemented in runner.py "
            f"(known: {known}). Fix: pick a registered family in /system-engine → "
            f"Models editor, or add the renderer in runner.py + chat-templates.mjs."
        )
    prompt, template_stops = fn(messages)
    prefix = (os.getenv("ELARA_LLM_PROMPT_PREFIX") or "").strip()
    if prefix:
        prompt = f"{prefix}\n{prompt}"
    extra_stops: list[str] = []
    try:
        es = json.loads(os.getenv("ELARA_LLM_STOP_SEQUENCES") or "[]")
        if isinstance(es, list):
            extra_stops = [str(s) for s in es if s]
    except Exception:
        pass
    stops = list(dict.fromkeys([*template_stops, *extra_stops]))[:8]
    return prompt, stops


def _build_sampling_kwargs(temp: float, mt: int, template_stops: list[str] | None = None) -> dict:
    """Assemble extra MLX sampling knobs from config_center constants.

    Yol C: /v1/completions. top_p + stop first-class; rep_pen / no_repeat
    → extra_body. chat_template_kwargs (env ELARA_LLM_CHAT_TEMPLATE_KWARGS)
    forwarded via extra_body so engines that consume it can disable thinking.
    """
    kwargs = {"temperature": temp, "max_tokens": mt}
    if cfg.AGENT_TOP_P and 0 < cfg.AGENT_TOP_P <= 1:
        kwargs["top_p"] = cfg.AGENT_TOP_P
    stops_merged: list[str] = []
    seen = set()
    for s in [*(template_stops or []), *(cfg.AGENT_STOP_SEQUENCES or [])]:
        s = str(s or "")
        if not s or s in seen:
            continue
        seen.add(s); stops_merged.append(s)
        if len(stops_merged) >= 8:
            break
    if stops_merged:
        kwargs["stop"] = stops_merged
    extra = {}
    if cfg.AGENT_REPETITION_PENALTY and cfg.AGENT_REPETITION_PENALTY != 1.0:
        extra["repetition_penalty"] = cfg.AGENT_REPETITION_PENALTY
    if cfg.AGENT_NO_REPEAT_NGRAM_SIZE and cfg.AGENT_NO_REPEAT_NGRAM_SIZE > 0:
        extra["no_repeat_ngram_size"] = cfg.AGENT_NO_REPEAT_NGRAM_SIZE
    try:
        ctk = json.loads(os.getenv("ELARA_LLM_CHAT_TEMPLATE_KWARGS") or "{}")
        if not isinstance(ctk, dict):
            ctk = {}
    except Exception:
        ctk = {}
    if os.getenv("ELARA_LLM_FORCE_DISABLE_THINKING", "").strip() == "1":
        ctk = {**ctk, "enable_thinking": False}
    if ctk:
        extra["chat_template_kwargs"] = ctk
    if extra:
        kwargs["extra_body"] = extra
    return kwargs



_MD_STRIP = re.compile(r"[`*_~>#]+")
# Digit-run normalizer: collapse every run of digits to '#'. Used to tell a
# genuine RAM-sink loop (identical text repeated) apart from a legitimate
# serially-numbered config dump (`set ssh-public-key6 none`, `...key7...`, …)
# where only an incrementing index differs. The latter must NOT be flagged.
_DIGIT_RUN = re.compile(r"\d+")


def _loop_watchdog_should_stop(text: str) -> bool:
    """Cheap local guard for agent ram-sink loops.

    MLX can occasionally ignore softer repetition controls and stream the same
    explanation forever. Stop the client-side stream as soon as a repeated line
    or phrase pattern is obvious, before the model keeps allocating/evicting.

    Hardened 2026-06-14: lower threshold (400ch), markdown-strip before line
    normalize, and a substring guard that catches markdown-fragmented repeats
    where splitlines() can't form clean lines.
    """
    if len(text) < 400:
        return False
    # Knobs from RAG panel → env (ELARA_LOOP_GUARD_*). Reread per call so a hot
    # restart of the panel takes effect on the next spawn without rebuilding.
    line_min  = cfg.LOOP_GUARD_LINE_MIN_CHARS
    line_rep  = cfg.LOOP_GUARD_LINE_REP
    sub_win   = cfg.LOOP_GUARD_SUBSTR_WIN
    sub_rep   = cfg.LOOP_GUARD_SUBSTR_REP
    phrase_rep = cfg.LOOP_GUARD_PHRASE_REP

    tail = text[-5000:]
    stripped = _MD_STRIP.sub("", tail)
    lines = [re.sub(r"\s+", " ", ln).strip().lower() for ln in stripped.splitlines()]
    counts = {}
    for ln in lines:
        # Skip short lines — section headers, config block markers (edit/next/
        # end), short headings naturally repeat across multi-scenario configs.
        if len(ln) < line_min:
            continue
        counts[ln] = counts.get(ln, 0) + 1
        if counts[ln] >= line_rep:
            return True

    # Enumerated-config detection (general, vendor-agnostic): when many lines
    # are identical AFTER digit normalization but every raw line is distinct,
    # they form a serially-numbered list (e.g. `set ssh-public-key6 none`,
    # `set ssh-public-key7 none`, …). That is legitimate output, not a loop —
    # so the substring/phrase guards below would only ever fire as a false
    # positive on it. Identical raw lines are already caught by the line guard
    # above, so skipping these guards here loses no real loop coverage.
    enumerated = False
    norm_groups = {}  # normalized template -> set of distinct raw lines
    for ln in lines:
        if len(ln) < 12:
            continue
        norm = _DIGIT_RUN.sub("#", ln)
        if norm == ln:
            continue  # no digits → not an enumerated line
        norm_groups.setdefault(norm, set()).add(ln)
    for norm, variants in norm_groups.items():
        # ≥3 occurrences AND each occurrence has a distinct number → enumeration
        if len(variants) >= 3:
            enumerated = True
            break

    # Markdown-agnostic substring guard: any `sub_win` char window repeated
    # ≥sub_rep times in the last 2000 chars (handles `**Konf` + `igürasyon**`
    # style splits). Wider window + higher repeat reduces config false-positives.
    sub_tail = re.sub(r"\s+", " ", stripped[-2000:]).lower()
    if not enumerated and len(sub_tail) >= 200 and sub_win > 0:
        seen = set()
        for i in range(0, max(0, len(sub_tail) - sub_win), 10):
            window = sub_tail[i:i + sub_win]
            if window in seen:
                continue
            seen.add(window)
            if sub_tail.count(window) >= sub_rep:
                return True

    if enumerated:
        return False
    words = re.findall(r"[\wğüşöçıİĞÜŞÖÇ]+", tail.lower())
    if len(words) < 90:
        return False
    phrase = " ".join(words[-14:])
    if not phrase or len(phrase) < 48:
        return False
    haystack = " ".join(words[-200:])
    return haystack.count(phrase) >= phrase_rep
    phrase = " ".join(words[-14:])
    if not phrase or len(phrase) < 48:
        return False
    haystack = " ".join(words[-200:])
    return haystack.count(phrase) >= phrase_rep


def stream_chat(payload: str, system_prompt: str | None = None,
                temperature: float | None = None,
                max_tokens: int | None = None,
                model: str | None = None) -> int:
    """MLX'e stream çağrı atar, chunk'ları stdout'a basar. Return: yazılan kar. sayısı."""
    requested_model = (model or cfg.effective_model() or "").strip()
    sys_prompt = system_prompt if system_prompt is not None else cfg.effective_system_prompt()
    temp = cfg.AGENT_TEMPERATURE if temperature is None else float(temperature)
    mt = cfg.AGENT_MAX_TOKENS if max_tokens is None else int(max_tokens)

    client = _build_client()
    mdl = _resolve_model(client, requested_model)

    messages = [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": payload},
    ]

    prompt_text, template_stops = _render_chat_prompt(messages)
    sampling = _build_sampling_kwargs(temp, mt, template_stops)
    diag_stops = sampling.get("stop") or []
    diag_extra = sampling.get("extra_body") or {}
    sys.stderr.write(
        f"[runner] sampling temp={sampling.get('temperature')} top_p={sampling.get('top_p')} "
        f"max_tokens={sampling.get('max_tokens')} stop={sampling.get('stop')} "
        f"extra={sampling.get('extra_body')}\n"
    )
    sys.stderr.write(
        f"[runner] env_diag family={(os.getenv('ELARA_LLM_TEMPLATE_FAMILY') or os.getenv('LLM_CHAT_TEMPLATE') or 'qwen2.5')} "
        f"force_disable_thinking={os.getenv('ELARA_LLM_FORCE_DISABLE_THINKING','0')} "
        f"agent_max_tokens_env={os.getenv('ELARA_AGENT_MAX_TOKENS','')} "
        f"agent_stop_env={os.getenv('ELARA_AGENT_STOP_SEQUENCES','[]')} "
        f"llm_stop_env={os.getenv('ELARA_LLM_STOP_SEQUENCES','[]')} "
        f"chat_template_kwargs={diag_extra.get('chat_template_kwargs')} "
        f"stops={diag_stops}\n"
    )

    # DEBUG: dump full prompt payload and exit without calling MLX.
    # Trigger with `ELARA_DUMP_PROMPT=1` in agent env (one-off diagnostic).
    if os.getenv("ELARA_DUMP_PROMPT"):
        try:
            dump = {
                "model": mdl,
                "requested_model": requested_model,
                "sampling": {k: v for k, v in sampling.items() if k != "extra_body"},
                "system_chars": len(sys_prompt or ""),
                "user_chars": len(payload or ""),
                "prompt_chars": len(prompt_text or ""),
                "messages": messages,
            }
            sys.stderr.write("[runner] DUMP_PROMPT=" + json.dumps(dump, ensure_ascii=False) + "\n")
        except Exception as _e:
            sys.stderr.write(f"[runner] dump failed: {_e}\n")
        print("[dry-run: prompt dumped to stderr]", flush=True)
        return 0



    t0 = time.time()
    ttft_ms = None
    total_chars = 0
    guard_text = ""
    try:
        # Yol C: mlx_lm 0.18.2 server YALNIZ /v1/completions yayınlar; chat
        # endpoint 404 döner. Template rendering yukarıda yapıldı.
        stream = client.completions.create(
            model=mdl,
            prompt=prompt_text,
            stream=True,
            **sampling,
        )

        finish_reason = None
        for chunk in stream:
            try:
                fr = getattr(chunk.choices[0], "finish_reason", None)
                if fr:
                    finish_reason = fr
            except (AttributeError, IndexError):
                pass
            try:
                delta = chunk.choices[0].text or ""
            except (AttributeError, IndexError):
                continue
            if not delta:
                continue
            if ttft_ms is None:
                ttft_ms = int((time.time() - t0) * 1000)
                sys.stderr.write(f"[runner] ttft_ms={ttft_ms} model={mdl}\n")
            print(delta, end="", flush=True)
            total_chars += len(delta)
            guard_text += delta
            if _loop_watchdog_should_stop(guard_text):
                sys.stderr.write("[runner] loop watchdog stopped repeated stream\n")
                print("\n\n[Stopped: repeated output guard]", flush=True)
                break
        print("", flush=True)
        total_ms = int((time.time() - t0) * 1000)
        sys.stderr.write(
            f"[runner] done total_ms={total_ms} chars={total_chars} "
            f"finish_reason={finish_reason or '-'} max_tokens={sampling.get('max_tokens')}\n"
        )
    except Exception as e:
        sys.stderr.write(f"[runner] stream error ({type(e).__name__}): {e}\n")
        loaded = _list_models(client)
        sterile = _sterilize_error(e, mdl, loaded)
        retried = False
        msg_lower = str(e).lower()
        is_404_like = ("404" in str(e)) or ("not found" in msg_lower) or ("snapshot" in msg_lower) or type(e).__name__ in ("NotFoundError", "HTTPStatusError")
        if total_chars == 0 and is_404_like:
            path_like = next((m for m in loaded if isinstance(m, str) and m.startswith("/")), None)
            fallback = path_like or (loaded[0] if loaded else None)
            if fallback and fallback != mdl:
                sys.stderr.write(f"[runner] retry with loaded model: {fallback} (candidates={loaded})\n")
                try:
                    stream = client.completions.create(
                        model=fallback,
                        prompt=prompt_text,
                        stream=True,
                        **sampling,
                    )
                    guard_text = ""
                    for chunk in stream:
                        try:
                            delta = chunk.choices[0].text or ""
                        except (AttributeError, IndexError):
                            continue
                        if not delta:
                            continue
                        print(delta, end="", flush=True)
                        total_chars += len(delta)
                        guard_text += delta
                        if _loop_watchdog_should_stop(guard_text):
                            sys.stderr.write("[runner] loop watchdog stopped repeated fallback stream\n")
                            print("\n\n[Stopped: repeated output guard]", flush=True)
                            break
                    print("", flush=True)
                    retried = True
                    sys.stderr.write(f"[runner] fallback ok model={fallback} chars={total_chars}\n")
                except Exception as e2:
                    sys.stderr.write(f"[runner] fallback failed: {e2}\n")
                    sterile = _sterilize_error(e2, fallback, loaded)
        if not retried:
            print(f"\n{sterile}", flush=True)
    return total_chars



def run_agent(payload: str) -> None:
    """Single-line helper used by agent scripts."""
    if not payload or not payload.strip():
        print("Agent dispatch received an empty instruction.", flush=True)
        return
    stream_chat(payload)
