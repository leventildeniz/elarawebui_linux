#!/usr/bin/env node
// reprocess-oversized-html.mjs — HTML chunk'larından uzunluğu > 8000 char veya
// < 32 char olanları tespit eder, dosya checksum'larını sıfırlayarak normal
// scan'in onları yeniden chunk + embed etmesini sağlar.
//
// Kullanım:
//   node local-server/scripts/reprocess-oversized-html.mjs           # DRY-RUN
//   node local-server/scripts/reprocess-oversized-html.mjs --apply   # reset + kick scan
//
// Not: localhost/loopback çağrıda token gerekmez. LAN/uzak çağrılar hâlâ
// oturum veya geçerli admin token ister.

import { adminPost } from "./_admin-fetch.mjs";

const APPLY = process.argv.includes("--apply");
console.log(`# reprocess-oversized-html   mode=${APPLY ? "APPLY" : "DRY-RUN"}`);

const { status, json } = await adminPost("/api/rag/reprocess-oversized-html", { dryRun: !APPLY });
console.log(JSON.stringify(json, null, 2));
if (status !== 200 || !json.ok) process.exit(1);
