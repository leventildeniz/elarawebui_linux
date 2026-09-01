#!/usr/bin/env python3
# @tool: youtube_upload
# @description: YouTube Data API v3 ile video yükler (resumable upload).
"""SYS tool · social.youtube.upload — upload a video via YouTube Data API v3.

Contract:
  argv[1] = JSON { "title": str, "description": str?, "privacy": "private|unlisted|public",
                   "file_path": str (local path), "tags": [str]?, "category_id": str? }
  Env: YT_ACCESS_TOKEN (OAuth2 bearer with youtube.upload scope; required).

Output: JSON { ok, video_id?, url?, error?, detail? }
Note: stdlib-only resumable upload via Google's `uploadType=resumable` endpoint.
"""
import os, sys, json, mimetypes, urllib.request, urllib.error

def parse_args():
    if len(sys.argv) < 2: return {}
    raw = sys.argv[1]
    try: return json.loads(raw) if raw.lstrip().startswith("{") else {"title": raw}
    except Exception: return {"title": raw}

def main():
    p = parse_args()
    token = os.environ.get("YT_ACCESS_TOKEN", "").strip()
    if not token:
        print(json.dumps({"ok": False, "error": "secret_missing", "keys": ["YT_ACCESS_TOKEN"],
                          "hint": "OAuth2 access token (scope: youtube.upload). Refresh via Google OAuth flow."})); return
    title = str(p.get("title") or "").strip()
    file_path = str(p.get("file_path") or "").strip()
    if not title:    print(json.dumps({"ok": False, "error": "missing_title"})); return
    if not file_path or not os.path.isfile(file_path):
        print(json.dumps({"ok": False, "error": "file_not_found", "path": file_path})); return

    privacy = p.get("privacy") if p.get("privacy") in ("private","unlisted","public") else "private"
    meta = {
        "snippet": {"title": title[:100], "description": str(p.get("description") or "")[:5000],
                    "tags": [str(t)[:30] for t in (p.get("tags") or [])][:15],
                    "categoryId": str(p.get("category_id") or "22")},
        "status":  {"privacyStatus": privacy},
    }

    try:
        init_url = ("https://www.googleapis.com/upload/youtube/v3/videos"
                    "?uploadType=resumable&part=snippet,status")
        size = os.path.getsize(file_path)
        mime = mimetypes.guess_type(file_path)[0] or "video/*"
        init_req = urllib.request.Request(init_url, data=json.dumps(meta).encode("utf-8"),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8",
                     "X-Upload-Content-Length": str(size), "X-Upload-Content-Type": mime})
        with urllib.request.urlopen(init_req, timeout=30) as r:
            upload_url = r.headers.get("Location")
        if not upload_url:
            print(json.dumps({"ok": False, "error": "no_resumable_url"})); return

        with open(file_path, "rb") as f:
            body = f.read()
        put_req = urllib.request.Request(upload_url, data=body, method="PUT",
            headers={"Content-Type": mime, "Content-Length": str(size)})
        with urllib.request.urlopen(put_req, timeout=600) as r:
            data = json.loads(r.read().decode("utf-8", errors="replace"))
        vid = data.get("id")
        print(json.dumps({"ok": True, "video_id": vid,
                          "url": f"https://youtu.be/{vid}" if vid else None,
                          "privacy": privacy}))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if e.fp else ""
        print(json.dumps({"ok": False, "error": "http_error", "status": e.code, "detail": body[:1000]}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": "upload_failed", "detail": str(e)}))

if __name__ == "__main__":
    main()
