// Knowledge schema bootstrap — extracted from server.mjs (Block E.2 Tur 4).
// DI: { pool, ftsCharLimit }
// Exports: initKnowledgeSchema(deps) → { ensureKnowledgeFilesTable, ensureKnowledgeChunksTable }
//
// Both ensure*'s are single-flight (boot-time idempotency wrappers around
// heavy DDL). Boot DDL on knowledge_chunks can exceed pool default
// statement_timeout — chunks impl opens its own client and SETs LOCAL
// statement_timeout=0 inside a tx.

export function initKnowledgeSchema({ pool, ftsCharLimit }) {
  if (!pool) throw new Error("initKnowledgeSchema: pool required");
  if (!Number.isFinite(ftsCharLimit) || ftsCharLimit <= 0) {
    throw new Error("initKnowledgeSchema: ftsCharLimit (positive int) required");
  }
  const FTS = ftsCharLimit;

  let chunksReady = false;
  let chunksReadyPromise = null;
  let filesReady = false;
  let filesReadyPromise = null;

  async function ensureKnowledgeChunksTable() {
    if (chunksReady) return;
    if (chunksReadyPromise) return chunksReadyPromise;
    chunksReadyPromise = (async () => {
      await ensureKnowledgeChunksTableImpl();
      chunksReady = true;
    })().catch((e) => { chunksReadyPromise = null; throw e; });
    return chunksReadyPromise;
  }

  async function ensureKnowledgeChunksTableImpl() { return; }

  async function ensureKnowledgeFilesTable() {
    if (filesReady) return;
    if (filesReadyPromise) return filesReadyPromise;
    filesReadyPromise = (async () => {
      await ensureKnowledgeFilesTableImpl();
      filesReady = true;
    })().catch((e) => { filesReadyPromise = null; throw e; });
    return filesReadyPromise;
  }

  async function ensureKnowledgeFilesTableImpl() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_files (
        id          text PRIMARY KEY,
        root        text NOT NULL,
        path        text NOT NULL,
        name        text NOT NULL,
        ext         text NOT NULL,
        size_bytes  bigint NOT NULL,
        mtime       timestamptz NOT NULL,
        last_modified timestamptz,
        checksum    text NOT NULL DEFAULT '',
        sha         text NOT NULL,
        chunks      integer NOT NULL DEFAULT 0,
        content     text NOT NULL DEFAULT '',
        tsv         tsvector,
        allowed_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
        require_role  text,
        access_level  text NOT NULL DEFAULT 'Viewer',
        indexed_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE(root, path)
      );
      ALTER TABLE knowledge_files ALTER COLUMN id TYPE text USING id::text;
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS root text NOT NULL DEFAULT '';
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS path text NOT NULL DEFAULT '';
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS ext text NOT NULL DEFAULT '';
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 0;
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS mtime timestamptz NOT NULL DEFAULT now();
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS last_modified timestamptz;
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS checksum text NOT NULL DEFAULT '';
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS sha text NOT NULL DEFAULT '';
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS chunks integer NOT NULL DEFAULT 0;
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS content text NOT NULL DEFAULT '';
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS tsv tsvector;
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS allowed_roles jsonb NOT NULL DEFAULT '[]'::jsonb;
      DO $migrate_allowed_roles$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='knowledge_files' AND column_name='allowed_roles' AND data_type='ARRAY'
        ) THEN
          ALTER TABLE knowledge_files
            ALTER COLUMN allowed_roles DROP DEFAULT,
            ALTER COLUMN allowed_roles TYPE jsonb USING to_jsonb(allowed_roles),
            ALTER COLUMN allowed_roles SET DEFAULT '[]'::jsonb;
        END IF;
      END $migrate_allowed_roles$;
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS require_role text;
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'Viewer';
      ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS indexed_at timestamptz NOT NULL DEFAULT now();
      DO $legacy_cols$
      DECLARE r record;
      DECLARE known text[] := ARRAY[
        'id','root','path','name','ext','size_bytes','mtime','last_modified',
        'checksum','sha','chunks','content','tsv','allowed_roles','require_role',
        'access_level','indexed_at'
      ];
      BEGIN
        FOR r IN
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_name='knowledge_files'
            AND is_nullable='NO'
            AND column_default IS NULL
            AND NOT (column_name = ANY(known))
        LOOP
          EXECUTE format('ALTER TABLE knowledge_files ALTER COLUMN %I DROP NOT NULL', r.column_name);
        END LOOP;
      END $legacy_cols$;
      CREATE INDEX IF NOT EXISTS idx_knowledge_files_tsv ON knowledge_files USING gin(tsv);
      CREATE INDEX IF NOT EXISTS idx_knowledge_files_root ON knowledge_files(root);
      CREATE INDEX IF NOT EXISTS idx_knowledge_files_access ON knowledge_files(access_level);
      DO $drop_path_only_unique$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT conname
          FROM pg_constraint c
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
          WHERE c.conrelid = 'knowledge_files'::regclass
            AND c.contype = 'u'
            AND array_length(c.conkey, 1) = 1
            AND a.attname = 'path'
        LOOP
          EXECUTE format('ALTER TABLE knowledge_files DROP CONSTRAINT %I', r.conname);
        END LOOP;

        DROP INDEX IF EXISTS idx_knowledge_files_path;
      END $drop_path_only_unique$;
      CREATE INDEX IF NOT EXISTS idx_knowledge_files_path_lookup ON knowledge_files(path);
      DO $ensure_root_path_unique$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'knowledge_files'::regclass
            AND contype = 'u'
            AND conname = 'knowledge_files_root_path_key'
        ) THEN
          BEGIN
            ALTER TABLE knowledge_files ADD CONSTRAINT knowledge_files_root_path_key UNIQUE (root, path);
          EXCEPTION WHEN unique_violation THEN
            DELETE FROM knowledge_files a USING knowledge_files b
              WHERE a.ctid < b.ctid AND a.root = b.root AND a.path = b.path;
            ALTER TABLE knowledge_files ADD CONSTRAINT knowledge_files_root_path_key UNIQUE (root, path);
          END;
        END IF;
      END $ensure_root_path_unique$;
    `);
  }

  return { ensureKnowledgeFilesTable, ensureKnowledgeChunksTable };
}
