#!/usr/bin/env python3
# @tool: mail_read
# @description: IMAP posta kutusundan mesaj okur (sender/mailbox/limit filtreleri).
"""SYS tool · mail.read — read messages from an IMAP mailbox.

Contract:
  argv[1] = JSON params OR plain text fallback.
  Recognised params: { "sender": str, "mailbox": str, "limit": int }
  Env: MAIL_HOST, MAIL_PORT (993), MAIL_USER, MAIL_PASSWORD, MAIL_USE_SSL (1)

Output: JSON { ok, count, messages: [{from,subject,date,body}], error? }
Missing credentials → { ok:false, error:"secret_missing", keys:[...] }
"""
import os, sys, json, email, imaplib
from email.header import decode_header

def parse_args():
    if len(sys.argv) < 2: return {}
    raw = sys.argv[1].strip()
    if not raw: return {}
    try: return json.loads(raw) if raw.startswith("{") else {"sender": raw}
    except Exception: return {"sender": raw}

def decode_str(s):
    if not s: return ""
    try:
        parts = decode_header(s)
        return "".join((p.decode(enc or "utf-8", errors="replace") if isinstance(p, bytes) else p) for p, enc in parts)
    except Exception: return str(s)

def main():
    p = parse_args()
    host = os.environ.get("MAIL_HOST", "").strip()
    user = os.environ.get("MAIL_USER", "").strip()
    pw   = os.environ.get("MAIL_PASSWORD", "").strip()
    missing = [k for k, v in (("MAIL_HOST", host), ("MAIL_USER", user), ("MAIL_PASSWORD", pw)) if not v]
    if missing:
        print(json.dumps({"ok": False, "error": "secret_missing", "keys": missing,
                          "hint": "Set MAIL_HOST/MAIL_USER/MAIL_PASSWORD via agent credentials vault."}))
        return

    port = int(os.environ.get("MAIL_PORT", "993") or 993)
    use_ssl = os.environ.get("MAIL_USE_SSL", "1") not in ("0", "false", "False", "")
    mailbox = str(p.get("mailbox") or "INBOX")
    sender = str(p.get("sender") or "").strip()
    limit  = max(1, min(50, int(p.get("limit") or 5)))

    try:
        M = (imaplib.IMAP4_SSL(host, port) if use_ssl else imaplib.IMAP4(host, port))
        M.login(user, pw)
        M.select(mailbox, readonly=True)
        search = ["ALL"] if not sender else ["FROM", f'"{sender}"']
        typ, data = M.search(None, *search)
        if typ != "OK":
            print(json.dumps({"ok": False, "error": "imap_search_failed"})); return
        ids = (data[0] or b"").split()[-limit:]
        out = []
        for uid in reversed(ids):
            typ, msg_data = M.fetch(uid, "(RFC822)")
            if typ != "OK" or not msg_data or not msg_data[0]: continue
            msg = email.message_from_bytes(msg_data[0][1])
            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    if part.get_content_type() == "text/plain":
                        try: body = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", errors="replace"); break
                        except Exception: pass
            else:
                try: body = msg.get_payload(decode=True).decode(msg.get_content_charset() or "utf-8", errors="replace")
                except Exception: body = str(msg.get_payload())
            out.append({
                "uid": uid.decode(), "from": decode_str(msg.get("From")),
                "subject": decode_str(msg.get("Subject")), "date": msg.get("Date") or "",
                "body": body[:4000],
            })
        M.logout()
        print(json.dumps({"ok": True, "count": len(out), "messages": out, "mailbox": mailbox}))
    except imaplib.IMAP4.error as e:
        print(json.dumps({"ok": False, "error": "imap_auth_failed", "detail": str(e)}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": "imap_error", "detail": str(e)}))

if __name__ == "__main__":
    main()
