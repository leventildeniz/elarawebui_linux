import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { Database, Download, RotateCcw, Upload, RefreshCcw } from "lucide-react";
import { Surface } from "@/components/sovereign/surface";
import { fetchApi } from "@/lib/api";
import { confirmAction } from "@/components/sovereign/confirm-dialog";
import { cn } from "@/lib/utils";

const description =
  "System snapshots, PostgreSQL cluster dumps and the archive catalog for the sovereign studio.";

export const Route = createFileRoute("/backup")({
  head: () => ({
    meta: [
      { title: "Backup & Restore — Elara Sovereign Studio" },
      { name: "description", content: description },
      { property: "og:title", content: "Backup & Restore — Elara Sovereign Studio" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BackupPage,
});

const btnCls =
  "flex items-center gap-2 rounded-lg border border-white/[0.08] bg-raised/40 px-3 py-[7px] font-mono text-[11.5px] text-muted-foreground/85 transition-colors hover:border-sapphire/50 hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed";

type BackupFile = {
  name: string;
  bytes: number;
  mtime: number;
  sha256: string | null;
};

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function BackupPage() {
  const [mode, setMode] = useState<"FULL" | "DB" | "FILES">("FULL");
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; tone: "ok" | "err" | "info" } | null>(
    null,
  );

  const fetchCatalog = useCallback(async () => {
    try {
      const res = await fetchApi("/backup/list");
      if (res.ok && res.files) {
        setFiles(res.files);
      }
    } catch (e: any) {
      setFeedback({ msg: `Failed to load catalog: ${e.message}`, tone: "err" });
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const handleExportSystem = async () => {
    setLoading(true);
    setFeedback({ msg: "Generating system snapshot (.eez)...", tone: "info" });
    try {
      const token = localStorage.getItem("sovereign.sessionId") || "";
      const url = `/api/backup/export?x-session-id=${token}&mode=${mode}`;
      
      const link = document.createElement("a");
      link.href = url;
      link.download = `elara-snapshot-${Date.now()}.eez`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setFeedback({ msg: "Export initiated. Check your downloads.", tone: "ok" });
      setTimeout(fetchCatalog, 3000);
    } catch (e: any) {
      setFeedback({ msg: `Export failed: ${e.message}`, tone: "err" });
    } finally {
      setLoading(false);
    }
  };

  const handleExportPgDump = async () => {
    setLoading(true);
    setFeedback({ msg: "Generating pg_dumpall (.eezpg)...", tone: "info" });
    try {
      const token = localStorage.getItem("sovereign.sessionId") || "";
      const url = `/api/backup/pg-dump?x-session-id=${token}`;
      
      const link = document.createElement("a");
      link.href = url;
      link.download = `elara-cluster-${Date.now()}.eezpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setFeedback({ msg: "pg_dumpall initiated. Check your downloads.", tone: "ok" });
      setTimeout(fetchCatalog, 3000);
    } catch (e: any) {
      setFeedback({ msg: `Cluster export failed: ${e.message}`, tone: "err" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (name: string) => {
    const ok = await confirmAction({
      title: `Delete backup ${name}?`,
      body: "This file will be permanently removed from disk. This action cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!ok) return;

    try {
      setLoading(true);
      await fetchApi(`/backup/file/${encodeURIComponent(name)}`, { method: "DELETE" });
      setFeedback({ msg: `Deleted ${name}`, tone: "ok" });
      fetchCatalog();
    } catch (e: any) {
      setFeedback({ msg: `Delete failed: ${e.message}`, tone: "err" });
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreFile = async (name: string) => {
    const ok = await confirmAction({
      title: `Restore from ${name}?`,
      body: "This will DROP current data and restart services. A safety snapshot will be created before proceeding.",
      confirmLabel: "Restore",
      cancelLabel: "Cancel",
      tone: "sapphire",
    });
    if (!ok) return;

    try {
      setLoading(true);
      setFeedback({ msg: `Restoring from ${name}...`, tone: "info" });
      const res = await fetchApi("/backup/restore-file", {
        method: "POST",
        body: JSON.stringify({ name, mode }),
      });
      if (res.ok) {
         setFeedback({ msg: `Restore queued/completed. System may restart.`, tone: "ok" });
      }
    } catch (e: any) {
      setFeedback({ msg: `Restore failed: ${e.message}`, tone: "err" });
    } finally {
      setLoading(false);
    }
  };

  const handleRollback = async () => {
    const ok = await confirmAction({
      title: "Rollback to pre-restore?",
      body: "This reverts the last restore action by restoring the automatic safety snapshot.",
      confirmLabel: "Rollback",
      cancelLabel: "Cancel",
      tone: "topaz",
    });
    if (!ok) return;

    try {
      setLoading(true);
      setFeedback({ msg: `Rolling back...`, tone: "info" });
      await fetchApi("/backup/rollback", { method: "POST" });
      setFeedback({ msg: `Rollback completed.`, tone: "ok" });
      fetchCatalog();
    } catch (e: any) {
      setFeedback({ msg: `Rollback failed: ${e.message}`, tone: "err" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Surface
      wide
      crumb="Backup & Restore"
      title="Backup & Restore"
      meta="SNAPSHOTS · CLUSTER DUMPS · RESTORE · CATALOG"
    >
      {feedback && (
        <div
          className={cn(
            "mb-4 rounded-lg border px-4 py-3 font-mono text-[12.5px]",
            feedback.tone === "err"
              ? "border-ruby/30 bg-ruby/5 text-ruby"
              : feedback.tone === "info"
                ? "border-topaz/30 bg-topaz/5 text-topaz"
                : "border-emerald/30 bg-emerald/5 text-emerald"
          )}
        >
          {feedback.msg}
        </div>
      )}

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-xl border border-white/[0.07] bg-white/[0.015] p-6"
      >
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-foreground">
              System snapshot (.eez)
            </h2>
            <p className="mt-2 font-mono text-[12px] text-muted-foreground/65">
              Code · DB (pg_dump -Fc) · uploads · config · memory. Pre-restore safety snapshot is
              automatic. node_modules/.git/models excluded.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] tracking-[0.16em] text-muted-foreground/50">
              RESTORE MODE
            </span>
            {(["FULL", "DB", "FILES"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-lg border px-3 py-[5px] font-mono text-[11px] tracking-[0.12em] transition-colors",
                  mode === m
                    ? "border-sapphire/45 bg-sapphire/12 text-sapphire"
                    : "border-white/[0.07] bg-raised/30 text-muted-foreground/70 hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </header>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            className={btnCls}
            onClick={handleExportSystem}
            disabled={loading}
          >
            <Download size={13} /> Export Snapshot (.eez)
          </button>
          <button className={btnCls} disabled>
            <Upload size={13} /> Import ({mode}) [WIP]
          </button>
          <button className={btnCls} onClick={handleRollback} disabled={loading}>
            <RotateCcw size={13} /> Rollback to pre-restore
          </button>
          <button className={btnCls} onClick={fetchCatalog} disabled={loading}>
            <RefreshCcw size={13} /> Refresh catalog
          </button>
        </div>

        <p className="mt-4 font-mono text-[11.5px] text-muted-foreground/50">
          Restore order: pre-flight → code (staging) → DB → uploads → atomic swap → restart. FULL
          mode may schedule a bridge restart to apply code changes.
        </p>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.015] p-6"
      >
        <div className="flex items-center gap-3">
          <Database size={15} className="text-amethyst" strokeWidth={1.6} />
          <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-foreground">
            PostgreSQL cluster backup
          </h2>
        </div>
        <p className="mt-3 max-w-[90ch] font-mono text-[12px] leading-relaxed text-muted-foreground/65">
          <span className="text-amethyst">pg_dumpall --globals-only</span> + per-DB{" "}
          <span className="text-amethyst">pg_dump -Fc</span> bundled in a .eezpg archive. Restores
          roles + every database, not just elara_db.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            className={btnCls}
            onClick={handleExportPgDump}
            disabled={loading}
          >
            <Download size={13} /> Export pg_dumpall (.eezpg)
          </button>
          <button className={btnCls} disabled>
            <Upload size={13} /> Restore (.eezpg / .dump / .sql) [WIP]
          </button>
        </div>
        <p className="mt-4 font-mono text-[11.5px] text-muted-foreground/50">
          Backend: GET /api/backup/pg-dump · POST /api/backup/pg-restore. Major-version mismatch is
          rejected.
        </p>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.015] p-6"
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-foreground">
            Backup catalog
          </h2>
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-emerald/40 px-2 py-[3px] font-mono text-[10.5px] tracking-[0.12em] text-emerald">
              AUTO-RESTART
            </span>
            <span className="rounded-md border border-white/[0.08] bg-raised/40 px-2 py-[3px] font-mono text-[10.5px] text-muted-foreground/70">
              {files.length} files
            </span>
          </div>
        </header>

        <div className="mt-4">
          {files.length === 0 ? (
            <p className="font-mono text-[12px] text-muted-foreground/55">
              No archives in BACKUP_DIR yet. Run an export above.
            </p>
          ) : (
            <div className="grid gap-2">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-white/[0.06] bg-raised/25 px-4 py-2.5 font-mono text-[12px] text-foreground/90"
                >
                  <div className="flex flex-col">
                    <span>{f.name}</span>
                    <span className="text-[10px] text-muted-foreground/50">
                      {new Date(f.mtime).toLocaleString()} · {formatBytes(f.bytes)} · {(f.name.split('.').pop() || 'Unknown').toUpperCase()}
                    </span>
                  </div>
                  <span className="flex items-center gap-3">
                    <button
                      className="font-mono text-[11px] text-muted-foreground/60 transition-colors hover:text-emerald disabled:opacity-50"
                      onClick={() => handleRestoreFile(f.name)}
                      disabled={loading}
                    >
                      RESTORE
                    </button>
                    <button
                      className="font-mono text-[11px] text-muted-foreground/60 transition-colors hover:text-ruby disabled:opacity-50"
                      onClick={() => handleDelete(f.name)}
                      disabled={loading}
                    >
                      DELETE
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="mt-4 font-mono text-[11.5px] text-muted-foreground/50">
          Files written under {"{UPLOAD_DIR}"}/backups. Each archive has a sibling .sha256.
          _pre-restore-*.dump entries are auto-snapshots taken right before any restore.
        </p>
      </motion.section>
    </Surface>
  );
}
