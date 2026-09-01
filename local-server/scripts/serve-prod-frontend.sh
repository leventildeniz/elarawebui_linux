#!/usr/bin/env bash
# ELARA Frontend — vite dev (HMR).
#
# NOT: Vite preview / production build denemesi TanStack Start + Cloudflare
# plugin mimarisiyle uyumsuz (worker bundle üretiyor, Node SSR değil →
# `dist/server/server.js` yok → ERR_MODULE_NOT_FOUND). Bu yüzden dev modunda
# kalıyoruz. Script adı plist referansını kırmamak için "serve-prod-frontend"
# olarak kaldı, ama gerçekte vite dev çalıştırıyor.
#
# RAM zemini: ~1.5-2 GB (HMR + esbuild + chokidar). Bunu düşürmek için
# Cloudflare plugin'i devre dışı bırakıp SPA build'e geçmek veya wrangler
# ile worker'ı local'de çalıştırmak gerekir — ayrı bir iş.
#
# HMR cache sorunlarına karşı (silinmiş endpoint'lere 401 çağrıları):
#   - tarayıcıda hard refresh: Cmd+Shift+R
#   - DevTools → Application → Service Workers → Unregister
#   - DevTools → Application → Storage → Clear site data
#
# Kullanım:
#   bash local-server/scripts/serve-prod-frontend.sh
#   PORT=8080 HOST=0.0.0.0 bash local-server/scripts/serve-prod-frontend.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8080}"
HOST="${HOST:-0.0.0.0}"

echo "[serve-dev] starting vite dev on ${HOST}:${PORT}"
exec bun run dev -- --host "$HOST" --port "$PORT" --strictPort
