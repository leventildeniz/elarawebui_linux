// lib/storage-engine.mjs — Enterprise Hybrid Storage & Document Ingestion Engine
// Handles Local NFS, S3/MinIO attachments, Base64 offloading, and on-the-fly document extraction for LLMs.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __bootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads active shared storage configuration from app_settings or defaults to local ./uploads
 */
export async function getStorageConfig(pool) {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'infra.storage' LIMIT 1"
    );
    if (rows[0]?.value) {
      return typeof rows[0].value === "string" ? JSON.parse(rows[0].value) : rows[0].value;
    }
  } catch (e) {
    // app_settings not ready or fallback
  }

  return {
    mode: "local",
    localPath: process.env.UPLOAD_DIR || "./uploads",
    authMode: "direct",
    vaultRef: "",
    s3: {},
  };
}

/**
 * Resolves absolute directory for local/NFS uploads and ensures directory exists.
 */
export function resolveStorageDir(config) {
  const configuredPath = config?.localPath || process.env.UPLOAD_DIR || "./uploads";
  const absPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(__bootDir, "../../", configuredPath);

  if (!fs.existsSync(absPath)) {
    fs.mkdirSync(absPath, { recursive: true });
  }
  return absPath;
}

/**
 * Determine file kind ('image' | 'audio' | 'file') from mime type and filename
 */
export function deriveAttachmentKind(mime = "", filename = "") {
  const m = String(mime).toLowerCase();
  const ext = path.extname(filename).toLowerCase();

  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg|tiff|ico)$/i.test(ext)) {
    return "image";
  }
  if (m.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac|webm|opus)$/i.test(ext)) {
    return "audio";
  }
  return "file";
}

/**
 * Saves an uploaded file buffer to shared storage and registers metadata in PostgreSQL `chat_files`.
 */
export async function saveAttachmentFile({
  pool,
  buffer,
  originalname,
  mimetype,
  threadId = null,
  messageId = null,
  tenantId = "default",
}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error("saveAttachmentFile: buffer must be a valid Buffer");
  }

  const config = await getStorageConfig(pool);
  const storageDir = resolveStorageDir(config);

  const cleanName = String(originalname || "attachment").replace(/[^\w.-]/g, "_");
  const ext = path.extname(cleanName).toLowerCase();
  const id = `att_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const storedFilename = `${id}${ext}`;
  const absFilePath = path.join(storageDir, storedFilename);

  // Write file to disk
  await fsp.writeFile(absFilePath, buffer);

  const size = buffer.length;
  const kind = deriveAttachmentKind(mimetype, cleanName);
  const mime = mimetype || (kind === "image" ? "image/png" : "application/octet-stream");
  const url = `/api/uploads/${id}`;

  // Ensure table has tenant_id column
  await pool.query(
    `ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'default';`
  ).catch(() => {});

  // Upsert to chat_files table
  await pool.query(
    `INSERT INTO chat_files (id, thread_id, message_id, name, size_bytes, kind, mime, url, storage_key, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO UPDATE SET 
       name = EXCLUDED.name,
       size_bytes = EXCLUDED.size_bytes,
       kind = EXCLUDED.kind,
       mime = EXCLUDED.mime,
       url = EXCLUDED.url,
       storage_key = EXCLUDED.storage_key,
       tenant_id = EXCLUDED.tenant_id`,
    [id, threadId, messageId, cleanName, size, kind, mime, url, storedFilename, tenantId || "default"]
  );

  return {
    id,
    name: cleanName,
    size,
    kind,
    mime,
    url,
    storageKey: storedFilename,
    path: absFilePath,
  };
}

/**
 * Retrieves attachment metadata and file path by ID or storage_key
 */
export async function getAttachmentFile(idOrKey, { pool, tenantId = "default", isSuperAdmin = false } = {}) {
  if (!idOrKey) return { exists: false, error: "Missing ID" };

  const config = await getStorageConfig(pool);
  const storageDir = resolveStorageDir(config);

  // 1. Search in chat_files
  const { rows } = await pool.query(
    `SELECT * FROM chat_files WHERE id = $1 OR storage_key = $1 LIMIT 1`,
    [idOrKey]
  );

  let row = rows[0];

  // 2. Fallback to legacy chat_attachments if not found
  if (!row) {
    const { rows: legacyRows } = await pool.query(
      `SELECT id::text, thread_id::text, filename as name, mime, size_bytes, stored as storage_key, path 
       FROM chat_attachments WHERE id::text = $1 OR stored = $1 LIMIT 1`,
      [idOrKey]
    ).catch(() => ({ rows: [] }));
    row = legacyRows[0];
  }

  if (!row) {
    // If ID matches a direct file in storageDir
    const candidatePath = path.join(storageDir, path.basename(idOrKey));
    if (fs.existsSync(candidatePath)) {
      const stats = fs.statSync(candidatePath);
      const ext = path.extname(candidatePath).toLowerCase();
      const kind = deriveAttachmentKind("", candidatePath);
      return {
        exists: true,
        absPath: candidatePath,
        row: {
          id: idOrKey,
          name: path.basename(candidatePath),
          size: stats.size,
          kind,
          mime: kind === "image" ? "image/png" : "application/octet-stream",
        },
      };
    }
    return { exists: false, error: "File not found in catalog" };
  }

  // Tenant visibility check (SuperAdmin sees all, normal user sees their tenant or null)
  if (!isSuperAdmin && row.tenant_id && row.tenant_id !== tenantId && row.tenant_id !== "default") {
    return { exists: false, error: "Forbidden (Tenant mismatch)" };
  }

  const storedFilename = row.storage_key || `${row.id}${path.extname(row.name || "")}`;
  const absPath = row.path && fs.existsSync(row.path)
    ? row.path
    : path.join(storageDir, storedFilename);

  if (!fs.existsSync(absPath)) {
    return { exists: false, error: "File binary missing from disk", row };
  }

  return {
    exists: true,
    absPath,
    row,
  };
}

/**
 * Deletes an attachment from shared storage disk and removes metadata from PostgreSQL.
 */
export async function deleteAttachmentFile(idOrKey, { pool }) {
  if (!idOrKey) return { ok: false };
  try {
    const fileRes = await getAttachmentFile(idOrKey, { pool, isSuperAdmin: true });
    if (fileRes.exists && fileRes.absPath && fs.existsSync(fileRes.absPath)) {
      await fsp.unlink(fileRes.absPath).catch(() => {});
    }
    await pool.query("DELETE FROM chat_files WHERE id = $1 OR storage_key = $1", [idOrKey]);
    await pool.query("DELETE FROM chat_attachments WHERE id::text = $1 OR stored = $1", [idOrKey]).catch(() => {});
    return { ok: true };
  } catch (err) {
    console.warn("[StorageEngine] deleteAttachmentFile notice:", err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Purges all attachment files (on disk and DB) associated with a given threadId.
 */
export async function purgeThreadAttachments(threadId, { pool }) {
  if (!threadId) return { ok: false };
  try {
    const config = await getStorageConfig(pool);
    const storageDir = resolveStorageDir(config);

    // 1. Find all files in chat_files
    const { rows: files } = await pool.query(
      "SELECT id, storage_key, name FROM chat_files WHERE thread_id = $1",
      [threadId]
    ).catch(() => ({ rows: [] }));

    // 2. Find legacy chat_attachments
    const { rows: legacyFiles } = await pool.query(
      "SELECT id::text, stored as storage_key, path FROM chat_attachments WHERE thread_id::text = $1",
      [threadId]
    ).catch(() => ({ rows: [] }));

    // 3. Unlink physical files from disk
    for (const f of [...files, ...legacyFiles]) {
      const candidate1 = f.path && fs.existsSync(f.path) ? f.path : null;
      const candidate2 = f.storage_key ? path.join(storageDir, f.storage_key) : null;
      const candidate3 = f.id ? path.join(storageDir, `${f.id}${path.extname(f.name || "")}`) : null;

      for (const p of [candidate1, candidate2, candidate3]) {
        if (p && fs.existsSync(p)) {
          await fsp.unlink(p).catch(() => {});
        }
      }
    }

    // 4. Delete from tables
    await pool.query("DELETE FROM chat_files WHERE thread_id = $1", [threadId]).catch(() => {});
    await pool.query("DELETE FROM chat_attachments WHERE thread_id::text = $1", [threadId]).catch(() => {});

    return { ok: true, purgedCount: files.length + legacyFiles.length };
  } catch (err) {
    console.warn("[StorageEngine] purgeThreadAttachments notice:", err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Resolves a chat attachment (image, PDF, doc, code) into an AI-ready wire format block.
 * - Images: converted to OpenAI / Anthropic base64 image_url block on-the-fly.
 * - PDFs / Documents / Code: text extracted via `extractFileContent` and inserted as structured context.
 */
export async function resolveAttachmentForLlm(att, { pool, extractFileContent }) {
  if (!att) return null;

  const url = String(att.url || "");
  const name = String(att.name || "attachment");
  const kind = att.kind || deriveAttachmentKind(att.mime, name);

  // Case A: Inlined Base64 Data URL
  if (url.startsWith("data:")) {
    if (kind === "image") {
      return { type: "image_url", image_url: { url } };
    }
    if (kind === "audio") {
      const base64 = url.slice(url.indexOf(",") + 1);
      return {
        type: "input_audio",
        input_audio: { data: base64, format: (att.mime || "audio/webm").split("/")[1] || "webm" },
      };
    }
    // Base64 document / text
    try {
      const base64Part = url.slice(url.indexOf(",") + 1);
      const textBuf = Buffer.from(base64Part, "base64");
      const ext = path.extname(name).toLowerCase();
      if (ext === ".pdf" && typeof extractFileContent === "function") {
        const tmpPath = path.join(resolveStorageDir({}), `tmp_extract_${Date.now()}_${name}`);
        await fsp.writeFile(tmpPath, textBuf);
        const extracted = await extractFileContent(tmpPath, ext);
        try { await fsp.unlink(tmpPath); } catch {}
        if (extracted?.ok && extracted?.content) {
          return {
            type: "text",
            text: `\n📄 [Attached Document: "${name}"]\n\`\`\`\n${extracted.content}\n\`\`\`\n[End of Document: "${name}"]\n`,
          };
        }
      }
      const rawText = textBuf.toString("utf8");
      if (rawText && rawText.length < 500000) {
        return {
          type: "text",
          text: `\n📄 [Attached File: "${name}"]\n\`\`\`\n${rawText}\n\`\`\`\n[End of File: "${name}"]\n`,
        };
      }
    } catch {}
    return { type: "text", text: `[Attached File: ${name}]` };
  }

  // Case B: Stored File URL (/api/uploads/:id or file ID)
  if (url.startsWith("/api/uploads/") || att.id) {
    const fileId = url.startsWith("/api/uploads/")
      ? url.replace("/api/uploads/", "")
      : att.id;

    const fileResult = await getAttachmentFile(fileId, { pool, isSuperAdmin: true });
    if (!fileResult.exists || !fileResult.absPath) {
      return { type: "text", text: `[Attachment ${name} unavailable]` };
    }

    const { absPath, row } = fileResult;
    const effectiveMime = row?.mime || att.mime || "application/octet-stream";
    const effectiveKind = row?.kind || kind;
    const ext = path.extname(name || absPath).toLowerCase();

    // 1. Image -> Convert to Base64 on-the-fly for Vision LLM
    if (effectiveKind === "image" || effectiveMime.startsWith("image/")) {
      try {
        const imgBuf = await fsp.readFile(absPath);
        const base64Data = imgBuf.toString("base64");
        const dataUrl = `data:${effectiveMime};base64,${base64Data}`;
        return { type: "image_url", image_url: { url: dataUrl } };
      } catch (err) {
        console.warn("[StorageEngine] Failed reading image for Vision LLM:", err.message);
        return { type: "text", text: `[Image ${name} read error]` };
      }
    }

    // 2. Audio -> Convert to input_audio
    if (effectiveKind === "audio" || effectiveMime.startsWith("audio/")) {
      try {
        const audioBuf = await fsp.readFile(absPath);
        const base64 = audioBuf.toString("base64");
        const format = (effectiveMime.split("/")[1] || "webm").split(";")[0];
        return { type: "input_audio", input_audio: { data: base64, format } };
      } catch (err) {
        return { type: "text", text: `[Audio ${name} read error]` };
      }
    }

    // 3. Document / PDF / Code / Text Extraction
    if (typeof extractFileContent === "function") {
      try {
        const extracted = await extractFileContent(absPath, ext);
        if (extracted?.ok && extracted?.content) {
          const docContent = extracted.content.trim();
          return {
            type: "text",
            text: `\n📄 [Attached Document: "${name}"]\n\`\`\`\n${docContent}\n\`\`\`\n[End of Document: "${name}"]\n`,
          };
        }
      } catch (extractErr) {
        console.warn("[StorageEngine] Extraction notice:", extractErr.message);
      }
    }

    // Fallback: Read as UTF-8 text if it is a text-based format
    try {
      const textBuf = await fsp.readFile(absPath);
      const rawText = textBuf.toString("utf8");
      // Check if binary / has null bytes
      if (!rawText.slice(0, 1024).includes("\0")) {
        return {
          type: "text",
          text: `\n📄 [Attached File: "${name}"]\n\`\`\`\n${rawText.slice(0, 300000)}\n\`\`\`\n[End of File: "${name}"]\n`,
        };
      }
    } catch {}

    return { type: "text", text: `[Attached Binary File: "${name}"]` };
  }

  return { type: "text", text: `[Attached: ${name}]` };
}
