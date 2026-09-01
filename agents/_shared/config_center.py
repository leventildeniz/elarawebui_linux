# agents/_shared/config_center.py
# Tek nokta: MLX/Gemini bağlantı parametreleri + ajan default'ları.
# Tüm değerler env'den okunur; ajan dosyaları bu sabitleri import eder,
# system prompt veya karakter TAŞIMAZ.
import json
import os


def _float_env(name: str, default: float, min_v: float, max_v: float) -> float:
    try:
        v = float(os.getenv(name, str(default)))
    except Exception:
        v = default
    return max(min_v, min(max_v, v))


def _int_env(name: str, default: int, min_v: int, max_v: int) -> int:
    try:
        v = int(float(os.getenv(name, str(default))))
    except Exception:
        v = default
    return max(min_v, min(max_v, v))

def _normalize_mlx_base(raw: str) -> str:
    """Strip trailing slashes and avoid /v1/v1 doubling.

    Operators register models with `http://127.0.0.1:8001` or
    `http://127.0.0.1:8001/v1`. The OpenAI Python client appends `/v1/...`
    paths itself, so if base ends with `/v1` we drop it and re-append for
    a deterministic single `/v1`.
    """
    s = (raw or "").rstrip("/")
    # Always end with /v1 — OpenAI SDK relies on it.
    if s.endswith("/v1"):
        return s
    return f"{s}/v1"


MLX_BASE_URL = _normalize_mlx_base(os.getenv("ELARA_MLX_BASE_URL", "http://127.0.0.1:8001/v1"))
MLX_MODEL = os.getenv("ELARA_MLX_MODEL", "default_model")

# Bridge tarafından ajan başına enjekte edilir (middleware DB'den çeker)
AGENT_ID = os.getenv("ELARA_AGENT_ID", "")
AGENT_SQUAD = os.getenv("ELARA_AGENT_SQUAD", "NetSec")
AGENT_SYSTEM_PROMPT = os.getenv("ELARA_AGENT_SYSTEM_PROMPT", "")
# UI = tek mercii. Bu sabitler SADECE env eksikse devreye girer; UI'dan
# gelen değer ne ise aynen kullanılır. Geniş aralık → sessiz daraltma YOK.
# Bk. mem://decisions/ui-params-single-source-all-entities-2026-05-28.md
AGENT_TEMPERATURE = _float_env("ELARA_AGENT_TEMPERATURE", 0.2, 0.0, 2.0)
AGENT_TOP_P = _float_env("ELARA_AGENT_TOP_P", 0.85, 0.0, 1.0)
AGENT_REPETITION_PENALTY = _float_env("ELARA_AGENT_REPETITION_PENALTY", 1.1, 0.5, 3.0)
AGENT_NO_REPEAT_NGRAM_SIZE = _int_env("ELARA_AGENT_NO_REPEAT_NGRAM_SIZE", 0, 0, 32)
AGENT_MAX_TOKENS = _int_env("ELARA_AGENT_MAX_TOKENS", 1200, 1, 32000)

# Loop watchdog knobs (RAG panel → injected per-spawn). Defaults match mlx_runner.
LOOP_GUARD_LINE_MIN_CHARS = _int_env("ELARA_LOOP_GUARD_LINE_MIN_CHARS", 40, 10, 200)
LOOP_GUARD_LINE_REP       = _int_env("ELARA_LOOP_GUARD_LINE_REP",       14, 3,  20)
LOOP_GUARD_SUBSTR_WIN     = _int_env("ELARA_LOOP_GUARD_SUBSTR_WIN",     120, 20, 200)
LOOP_GUARD_SUBSTR_REP     = _int_env("ELARA_LOOP_GUARD_SUBSTR_REP",     20, 3,  20)
LOOP_GUARD_PHRASE_REP     = _int_env("ELARA_LOOP_GUARD_PHRASE_REP",     12, 3,  20)
AGENT_MODEL_OVERRIDE = os.getenv("ELARA_AGENT_MODEL", "").strip()
try:
    _stops = [str(x) for x in json.loads(os.getenv("ELARA_AGENT_STOP_SEQUENCES", "[]")) if str(x)]
except Exception:
    _stops = []
# UI tek mercii — "\n\n\n" zorunlu enjeksiyonu KALKTI. Sadece UI'da kayıtlı
# stop dizileri kullanılır. Boş liste = stop yok.
AGENT_STOP_SEQUENCES = []
for _s in _stops:
    if _s and _s not in AGENT_STOP_SEQUENCES:
        AGENT_STOP_SEQUENCES.append(_s)
AGENT_STOP_SEQUENCES = AGENT_STOP_SEQUENCES[:8]


# Stream timeouts (httpx)
HTTP_CONNECT_TIMEOUT = float(os.getenv("ELARA_HTTP_CONNECT_TIMEOUT", "5"))
HTTP_READ_TIMEOUT = float(os.getenv("ELARA_HTTP_READ_TIMEOUT", "120"))
HTTP_WRITE_TIMEOUT = float(os.getenv("ELARA_HTTP_WRITE_TIMEOUT", "10"))
HTTP_POOL_TIMEOUT = float(os.getenv("ELARA_HTTP_POOL_TIMEOUT", "5"))

# Gemini (researcher)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# Default fallback prompt (sadece DB/env boşsa kullanılır)
DEFAULT_SYSTEM_PROMPT = (
    "Sen ELARA'nın Kurmay Heyetindeki bir ajansın. Mimar babacığım hitabını kullan, "
    "vakur ve liyakatli bir üslupla teknik analiz ve operasyon raporu sunarsın."
)


def _build_tools_block() -> str:
    """Middleware tarafından `ELARA_AGENT_TOOLS` env'ine yazılan JSON manifest'i
    insan-okuyabilir blok'a çevirir. Boş/geçersizse boş string döner — yani
    tool sahibi olmayan ajanlarda system prompt'a hiçbir şey eklenmez.

    Beklenen format:
        [{"slug": "echo", "description": "...", "system_prompt": "..."}, ...]

    `ELARA_AGENT_TOOL_PROMPT_GUIDE=1` ise her tool için `system_prompt`
    (action_library.system_prompt) "Guidance:" satırı olarak eklenir.
    Knob: RAG_SETTINGS.includeToolPromptsInAgent (UI).
    """
    raw = os.getenv("ELARA_AGENT_TOOLS", "").strip()
    if not raw:
        return ""
    try:
        items = json.loads(raw)
    except Exception:
        return ""
    if not isinstance(items, list) or not items:
        return ""
    include_guidance = os.getenv("ELARA_AGENT_TOOL_PROMPT_GUIDE", "").strip() == "1"
    # UI override (2026-06-03 Tur 2): operator can replace the framing header
    # from RAG panel. Placeholder {TOOLS} is substituted with the bulleted
    # tool list. If empty, fall back to the in-code default header.
    frame_override = os.getenv("ELARA_AGENT_TOOLS_MANIFEST_FRAME", "").strip()
    default_header = [
        "Available tools — call EXACTLY one tool per line using:",
        '  !slug({"key":"value"})',
        "Output the tool call on its own line; do not wrap it in code fences.",
        "",
    ]
    tool_lines = []
    listed = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        slug = str(it.get("slug", "")).strip()
        if not slug:
            continue
        desc = str(it.get("description", "")).strip()
        tool_lines.append(f"- !{slug}" + (f" — {desc}" if desc else ""))
        if include_guidance:
            sysp = str(it.get("system_prompt", "")).strip()
            if sysp:
                flat = " ".join(sysp.split())[:800]
                tool_lines.append(f"    Guidance: {flat}")
        listed += 1
    if not listed:
        return ""
    tools_block_text = "\n".join(tool_lines)
    if frame_override:
        # Substitute {TOOLS}; if placeholder absent, append the list at the end.
        if "{TOOLS}" in frame_override:
            return frame_override.replace("{TOOLS}", tools_block_text)
        return frame_override.rstrip() + "\n" + tools_block_text
    return "\n".join(default_header + [tools_block_text])


def _build_now_block() -> str:
    """REALTIME CONTEXT (2026-06-02) — middleware injects server-authority "now"
    plus optional UI hint via ELARA_NOW_SERVER / ELARA_NOW_EPOCH_MS / ELARA_TZ_SERVER
    / ELARA_NOW_USER / ELARA_TZ_USER. Build a deterministic sealed block so the
    LLM uses real time instead of training-cutoff guesswork. Empty if no env."""
    server_now = os.getenv("ELARA_NOW_SERVER", "").strip()
    if not server_now:
        return ""
    lines = ["[REALTIME CONTEXT]", f"server_now: {server_now}"]
    epoch = os.getenv("ELARA_NOW_EPOCH_MS", "").strip()
    if epoch:
        lines.append(f"epoch_ms: {epoch}")
    user_now = os.getenv("ELARA_NOW_USER", "").strip()
    user_tz = os.getenv("ELARA_TZ_USER", "").strip()
    if user_now and user_tz:
        lines.append(f"user_local: {user_now} ({user_tz})")
    lines.append("Bilgi kesim tarihini değil, bu bloğu gerçek 'şu an' olarak kullan.")
    return "\n".join(lines)



def _build_rag_block() -> str:
    """Middleware-injected RAG context (ELARA_AGENT_RAG_CONTEXT) → sealed prompt block.

    Payload shape: {"query": "...", "hits": [{"chunk_id":..., "text":...}, ...]}.
    Returns "" if RAG is disabled. When enabled but no hits, returns a strict
    "no source" guard so the agent must say "kaynak yok" instead of hallucinating.
    """
    if os.getenv("ELARA_AGENT_RAG_ENABLED", "").strip() != "1":
        return ""
    raw = os.getenv("ELARA_AGENT_RAG_CONTEXT", "").strip()
    hits = []
    if raw:
        try:
            obj = json.loads(raw)
            hits = obj.get("hits") if isinstance(obj, dict) else None
            hits = hits if isinstance(hits, list) else []
        except Exception:
            hits = []
    if not hits:
        # UI override (2026-06-03 Tur 2): operator-editable from RAG panel.
        no_hits_override = os.getenv("ELARA_AGENT_RAG_NO_HITS_DIRECTIVE", "").strip()
        if no_hits_override:
            return no_hits_override
        return (
            "KNOWLEDGE CONTEXT: library was consulted; no matching snippets for this query.\n"
            "MANDATORY OPENING LINE (in the user's language): start your reply with one short sentence such as "
            "\"Kütüphaneme baktım, bu konuda eşleşen kaynak yok; kendi bilgimle cevaplıyorum:\" "
            "(or the equivalent in the user's language). Do NOT skip this line.\n"
            "Then answer FULLY from your own domain knowledge — be concrete with vendor commands, syntax, defaults and procedures. "
            "Do NOT refuse, do NOT say only 'bilmiyorum'.\n"
            "If a technical term in the question looks like a typo of a well-known standard term, answer using the correct standard term — "
            "do NOT repeat the misspelling and do NOT invent a meaning/expansion for the misspelled form."
        )

    # Build a short, deduplicated list of source labels for the opening line.
    src_labels: list[str] = []
    seen = set()
    for h in hits:
        if not isinstance(h, dict):
            continue
        path = str(h.get("path") or "").strip()
        if not path:
            continue
        base = path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        # strip extension noise
        for ext in (".pdf", ".PDF", ".html", ".htm", ".md", ".txt"):
            if base.endswith(ext):
                base = base[: -len(ext)]
                break
        brand = str(h.get("brand") or "").strip()
        label = f"{base} ({brand})" if brand else base
        if label not in seen:
            seen.add(label)
            src_labels.append(label)
        if len(src_labels) >= 6:
            break
    src_line = ", ".join(src_labels) if src_labels else "the snippets below"

    # UI override (2026-06-03 Tur 2): operator-editable from RAG panel.
    # Placeholder {SOURCES} is substituted with the deduplicated source labels.
    with_hits_override = os.getenv("ELARA_AGENT_RAG_WITH_HITS_DIRECTIVE", "").strip()
    if with_hits_override:
        directive_text = with_hits_override.replace("{SOURCES}", src_line)
        lines = [directive_text, ""]
    else:
        lines = [
            "KNOWLEDGE CONTEXT — AUTHORITATIVE SOURCES BELOW. You MUST build your answer on these snippets.",
            f"OPENING LINE (mandatory): start your reply with ONE short sentence in the user's language stating that you consulted these sources: {src_line}. Do not invent source names; use only the labels listed.",
            "VENDOR/TOPIC MATCH CHECK: Same-vendor product families count as the SAME vendor — Fortinet: FortiGate/FortiOS/FortiManager/FortiAnalyzer/FortiSwitch/FortiAP/FortiClient; Cisco: ASA/Firepower/IOS/NX-OS/Nexus; Check Point: SmartConsole/Gaia/R8x; Palo Alto: PAN-OS/Panorama; Citrix: NetScaler/ADC. Only when the question and snippets belong to COMPLETELY DIFFERENT vendors (e.g. question 'Cisco ASA' but snippets only Fortinet/Check Point) refuse to cite — open with: 'Kütüphanede bu konu için doğrudan kaynak yok; kendi bilgimle özetliyorum:' and answer from your own knowledge (no [#N] citations). For different products/versions of the SAME vendor, treat the snippets as relevant and cite normally.",
            "PRIMARY RULE: When the snippets DO cover the question, base every concrete claim (commands, syntax, version behavior, defaults, limits) on them and cite inline like [#1], [#2]. Do NOT answer from model memory when the snippets cover the topic.",
            "FORBIDDEN PHRASES: When the snippets cover the topic and you cite them, you MUST NOT write any of these or paraphrases: 'kendi bilgi birikimimden', 'kütüphaneye başvurulmamıştır', '(Model Bilgisi)', 'Model Knowledge', 'from my own knowledge', 'no library was consulted'. These contradict the fact that snippets were injected.",
            "NO PADDING: Do NOT add an 'Ek Bilgiler', 'Additional Information', 'General Knowledge' or similar trailing section. Do NOT volunteer uncited background just to look thorough. If the snippets answer the question, stop there.",
            "PARTIAL COVERAGE: Only when the user explicitly asked a sub-question that NO snippet covers, address that sub-question inline (not in a new section) with a brief '— snippet'lerde yok, genel bilgiden:' marker on that line. If every part of the question is covered, never write that marker.",
            "NEVER fabricate vendor commands or version numbers; if uncertain, label them as general guidance.",
            "TERMINOLOGY: if a technical term in the question is close to but not identical to the term used in the snippets (a likely typo/misspelling), do NOT repeat the user's spelling — use the canonical term from the snippets and build the whole answer on it. Never invent an expansion or meaning for the misspelled form.",
            "",
        ]

    try:
        budget = max(3000, min(24000, int(os.getenv("ELARA_AGENT_RAG_BUDGET_CHARS", "12000"))))
    except Exception:
        budget = 12000
    used = 0
    for i, h in enumerate(hits, 1):
        if not isinstance(h, dict):
            continue
        text = str(h.get("text", "")).strip()
        if not text:
            continue
        path = str(h.get("path") or "").strip()
        brand = str(h.get("brand") or "").strip()
        head_bits = []
        if path:
            head_bits.append(path.rsplit("/", 1)[-1])
        if brand:
            head_bits.append(brand)
        head = f"[#{i}] " + (" · ".join(head_bits) + "\n" if head_bits else "")
        snippet = text[:1200]
        piece = head + snippet
        if used + len(piece) > budget:
            break
        lines.append(piece)
        used += len(piece)
    return "\n".join(lines)


def effective_system_prompt() -> str:
    import sys as _sys
    base = AGENT_SYSTEM_PROMPT or DEFAULT_SYSTEM_PROMPT
    # Faz D (2026-05-28): capability_pack system_prompt'ları PREPEND.
    # Pack katmanı (sektörel persona) önce, agent kendi promptu sonra — agent
    # pack overlay'ini özelleştirme/rafine etme hakkına sahip son söz.
    pack_overlay = os.getenv("ELARA_AGENT_PACK_PROMPT", "").strip()
    parts = []
    # REALTIME CONTEXT en başta — pack persona / agent / tools / rag hepsinden ÖNCE.
    now_block = _build_now_block()
    if now_block:
        parts.append(now_block)
    if pack_overlay:
        parts.append(pack_overlay)
    parts.append(base)
    tools_block = _build_tools_block()
    if tools_block:
        parts.append(tools_block)
    rag_block = _build_rag_block()
    if rag_block:
        parts.append(rag_block)
    try:
        _sys.stderr.write(f"[config_center] pack_overlay_chars={len(pack_overlay)} rag_enabled={os.getenv('ELARA_AGENT_RAG_ENABLED','0')} rag_block_chars={len(rag_block)} tools_block_chars={len(tools_block)}\n")
    except Exception:
        pass
    return "\n\n---\n".join(parts)



def effective_model() -> str:
    return AGENT_MODEL_OVERRIDE or MLX_MODEL
