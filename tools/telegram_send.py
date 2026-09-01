#!/usr/bin/env python3
# @tool: telegram_send
# @description: Telegram Bot API ile mesaj gönderir.
"""SYS tool · output.telegram — send a message via Telegram Bot API.

Contract:
  argv[1] = JSON { "chat_id": str, "text": str, "parse_mode": str? } OR plain text.
  Env: TELEGRAM_BOT_TOKEN (required), TELEGRAM_DEFAULT_CHAT_ID (optional fallback).

Output: JSON { ok, message_id?, error?, detail? }
"""
import os, sys, json, urllib.request, urllib.error

def parse_args():
    if len(sys.argv) < 2: return {}
    raw = sys.argv[1]
    if raw and raw.lstrip().startswith("{"):
        try: return json.loads(raw)
        except Exception: pass
    return {"text": raw}

def main():
    p = parse_args()
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        print(json.dumps({"ok": False, "error": "secret_missing", "keys": ["TELEGRAM_BOT_TOKEN"],
                          "hint": "Add TELEGRAM_BOT_TOKEN to agent credentials vault."})); return
    chat_id = str(p.get("chat_id") or os.environ.get("TELEGRAM_DEFAULT_CHAT_ID", "")).strip()
    text    = str(p.get("text") or "").strip()
    if not chat_id:
        print(json.dumps({"ok": False, "error": "missing_chat_id"})); return
    if not text:
        print(json.dumps({"ok": False, "error": "empty_text"})); return

    payload = {"chat_id": chat_id, "text": text[:4000]}
    pm = p.get("parse_mode")
    if pm in ("Markdown", "MarkdownV2", "HTML"): payload["parse_mode"] = pm

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace"))
        if data.get("ok"):
            print(json.dumps({"ok": True, "message_id": (data.get("result") or {}).get("message_id"), "chat_id": chat_id}))
        else:
            print(json.dumps({"ok": False, "error": "telegram_api", "detail": data.get("description", "")}))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        print(json.dumps({"ok": False, "error": "http_error", "status": e.code, "detail": body[:500]}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": "send_failed", "detail": str(e)}))

if __name__ == "__main__":
    main()
