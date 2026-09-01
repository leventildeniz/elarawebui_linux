// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import os from "node:os";

// Dev-only LAN discovery: when the page is opened via `.local` hostname and
// the browser's mDNS lookup flakes, the frontend pivots to a numeric Mac IP.
// This middleware exposes those IPs so JS can probe `:3005` directly without
// relying on DNS for every API/heartbeat/SSE call.
function lanDiscoveryPlugin() {
  return {
    name: "lan-bridge-discovery",
    configureServer(server: { middlewares: { use: (path: string, fn: (req: unknown, res: { setHeader: (k: string, v: string) => void; end: (b?: string) => void }) => void) => void } }) {
      server.middlewares.use("/__bridge/discovery", (_req, res) => {
        const ips: string[] = [];
        try {
          const ifs = os.networkInterfaces();
          for (const name of Object.keys(ifs)) {
            for (const it of ifs[name] || []) {
              if (!it || it.internal) continue;
              if (String(it.family) !== "IPv4" && (it as unknown as { family: number }).family !== 4) continue;
              if (!it.address) continue;
              ips.push(it.address);
            }
          }
        } catch { /* best-effort */ }
        const unique = [...new Set(ips)];
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(JSON.stringify({
          ok: true,
          host: os.hostname(),
          ips: unique,
          candidates: unique.map((ip) => `http://${ip}:3005`),
          http_candidates: unique.map((ip) => `http://${ip}:3005`),
          https_candidates: unique.map((ip) => `https://${ip}:3006`),
        }));
      });
    },
  };
}

export default defineConfig({
  vite: {
    server: {
      host: "0.0.0.0",
      port: 8080,
      // Universal: hostname (LAN, mDNS .local, IP) ne olursa olsun bloklama.
      allowedHosts: true,
    },
    plugins: [lanDiscoveryPlugin()],
  },
});
