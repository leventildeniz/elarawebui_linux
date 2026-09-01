#!/usr/bin/env python3
# @tool: image_compose
# @description: Sosyal medya görseli üretir (kare/portre/story/yatay), başlık + altyazı ile.
# @args: {"template":"string","title":"string","subtitle":"string","brand_color":"string","bg_image_path":"string","output_path":"string","font_path":"string"}
# @category: SocialMedia
# @icon: Image
# @color: #ec4899
"""image_compose — render a sized PNG for social posts.

stdin JSON: {template, title, subtitle?, brand_color?, bg_image_path?, output_path, font_path?}
- template: square_text (1080x1080) | story_quote (1080x1920) | landscape_announce (1920x1080)
- output_path: must be inside tools/_workdir/ or /mnt/documents/
- bg_image_path: optional; same whitelist
- brand_color: hex (#rrggbb) for accent bar; default #111827
- Requires Pillow; missing → {ok:false, reason:"missing_dependency"}.
"""
import json
import os
import sys

TEMPLATES = {
    "square_text":        (1080, 1080),
    "story_quote":        (1080, 1920),
    "landscape_announce": (1920, 1080),
    "portrait_45":        (1080, 1350),
}

ALLOWED_ROOTS = ("tools/_workdir", "/mnt/documents")


def _read():
    try:
        return {} if sys.stdin.isatty() else (json.load(sys.stdin) or {})
    except Exception:
        return {}


def _safe_path(p: str) -> bool:
    if not p:
        return False
    ap = os.path.abspath(p)
    for root in ALLOWED_ROOTS:
        root_abs = os.path.abspath(root) if not root.startswith("/") else root
        if ap.startswith(root_abs + os.sep) or ap == root_abs:
            return True
    return False


def _hex_to_rgb(h: str, default=(17, 24, 39)):
    try:
        h = (h or "").strip().lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) != 6:
            return default
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return default


def _load_font(size: int, font_path: str = ""):
    from PIL import ImageFont
    candidates = []
    if font_path:
        candidates.append(font_path)
    candidates += [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for c in candidates:
        try:
            if c and os.path.exists(c):
                return ImageFont.truetype(c, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _wrap(text: str, font, max_w: int, draw) -> list:
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        try:
            bbox = draw.textbbox((0, 0), trial, font=font)
            tw = bbox[2] - bbox[0]
        except Exception:
            tw = len(trial) * font.size // 2
        if tw <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def main() -> None:
    p = _read()
    template = str(p.get("template") or "").strip()
    title = str(p.get("title") or "").strip()
    subtitle = str(p.get("subtitle") or "").strip()
    output_path = str(p.get("output_path") or "").strip()
    bg_image_path = str(p.get("bg_image_path") or "").strip()
    font_path = str(p.get("font_path") or "").strip()
    brand_color = _hex_to_rgb(str(p.get("brand_color") or "#111827"))

    if template not in TEMPLATES:
        print(json.dumps({"ok": False, "reason": "unknown_template",
                          "allowed": list(TEMPLATES.keys())})); return
    if not title:
        print(json.dumps({"ok": False, "reason": "missing_title"})); return
    if not output_path:
        print(json.dumps({"ok": False, "reason": "missing_output_path"})); return
    if not _safe_path(output_path):
        print(json.dumps({"ok": False, "reason": "output_path_not_allowed",
                          "allowed_roots": list(ALLOWED_ROOTS)})); return
    if bg_image_path and not _safe_path(bg_image_path):
        print(json.dumps({"ok": False, "reason": "bg_image_path_not_allowed"})); return

    try:
        from PIL import Image, ImageDraw
    except ImportError:
        print(json.dumps({"ok": False, "reason": "missing_dependency",
                          "detail": "pip install Pillow"})); return

    W, H = TEMPLATES[template]
    try:
        if bg_image_path and os.path.exists(bg_image_path):
            bg = Image.open(bg_image_path).convert("RGB")
            bg = bg.resize((W, H))
            img = bg
            overlay = Image.new("RGBA", (W, H), (0, 0, 0, 110))
            img = img.convert("RGBA")
            img.alpha_composite(overlay)
            img = img.convert("RGB")
            text_color = (255, 255, 255)
        else:
            img = Image.new("RGB", (W, H), (245, 245, 247))
            text_color = (17, 24, 39)

        draw = ImageDraw.Draw(img)

        # Accent bar (left side, brand color)
        bar_w = max(8, W // 90)
        draw.rectangle([(0, 0), (bar_w, H)], fill=brand_color)

        # Layout zone
        pad = int(W * 0.07)
        zone_w = W - 2 * pad
        title_size = max(40, W // 14)
        subtitle_size = max(24, W // 28)

        title_font = _load_font(title_size, font_path)
        subtitle_font = _load_font(subtitle_size, font_path)

        title_lines = _wrap(title, title_font, zone_w, draw)
        subtitle_lines = _wrap(subtitle, subtitle_font, zone_w, draw) if subtitle else []

        # Vertical centering
        line_h_t = int(title_size * 1.2)
        line_h_s = int(subtitle_size * 1.35)
        total_h = len(title_lines) * line_h_t + (line_h_s if subtitle_lines else 0) + len(subtitle_lines) * line_h_s
        y = (H - total_h) // 2

        for line in title_lines:
            draw.text((pad, y), line, fill=text_color, font=title_font)
            y += line_h_t

        if subtitle_lines:
            y += line_h_s // 2
            sub_color = (107, 114, 128) if text_color != (255, 255, 255) else (229, 231, 235)
            for line in subtitle_lines:
                draw.text((pad, y), line, fill=sub_color, font=subtitle_font)
                y += line_h_s

        os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
        img.save(output_path, "PNG", optimize=True)
        size_bytes = os.path.getsize(output_path)

        print(json.dumps({
            "ok": True,
            "path": output_path,
            "template": template,
            "width": W, "height": H,
            "size_bytes": size_bytes,
        })); return
    except Exception as e:
        print(json.dumps({"ok": False, "reason": "render_failed", "detail": str(e)[:240]})); return


if __name__ == "__main__":
    main()
