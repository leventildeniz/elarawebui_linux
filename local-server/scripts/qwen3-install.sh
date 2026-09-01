#!/usr/bin/env bash
# qwen3-install.sh — Qwen3-32B-4bit yan-yana kurulum + DB seed + swap helper
#
# Mode'lar:
#   --download       : ~/models/Qwen3-32B-4bit'e indir + cold smoke (RAM ölç)
#   --seed-disabled  : DB'ye qwen3 satırı ekle, status='offline', is_default=false
#                      (Qwen3 default'larıyla: /no_think prefix, enable_thinking=false,
#                       stop sequences, Qwen3 önerilen sampling.)
#   --activate       : Qwen2.5'i offline'a al, Qwen3'ü ready+is_default yap
#                      (idempotent; MLX restart YAPMAZ — UI'dan tetikle)
#   --rollback       : Qwen3'ü offline'a al, Qwen2.5'i ready+is_default yap
#   --status         : Models tablosunun snapshot'u
#
# Default: --status. İndirme + seed + activate KESİNLİKLE manuel onayla.
#
# DB: $DB_NAME (default elara_db) · psql local socket
# Model dir: $MODELS_DIR (default ~/models)

set -euo pipefail

DB="${DB_NAME:-elara_db}"
MODELS_DIR="${MODELS_DIR:-$HOME/models}"
MODE="${1:---status}"

QWEN3_REPO="mlx-community/Qwen3-32B-4bit"
QWEN3_ID="qwen3-32b-4bit"
QWEN3_NAME="Qwen3-32B-Instruct-4bit"
QWEN3_DIR="$MODELS_DIR/Qwen3-32B-4bit"

QWEN25_ID_PREFIX="qwen2.5-32b"  # eski Qwen2.5 satırlarını LIKE ile yakalar

psql_q() { psql -d "$DB" -At -c "$1"; }
psql_p() { psql -d "$DB" -c "$1"; }

hr() { printf '%s\n' "------------------------------------------------------------"; }
section() { echo; hr; echo "==> $1"; hr; }

# ----------------------------------------------------------------------------
case "$MODE" in

--download)
  section "Qwen3-32B-4bit indirme (~20GB)"
  if command -v hf >/dev/null 2>&1; then
    HF_BIN="hf"
    HF_STYLE="new"
  elif command -v huggingface-cli >/dev/null 2>&1; then
    HF_BIN="huggingface-cli"
    HF_STYLE="old"
  else
    echo "HATA: 'hf' veya 'huggingface-cli' bulunamadi. pip install -U huggingface_hub"
    exit 1
  fi
  mkdir -p "$MODELS_DIR"
  df -h "$MODELS_DIR" | tail -1
  echo
  echo "Repo:   $QWEN3_REPO"
  echo "Hedef:  $QWEN3_DIR"
  echo "CLI:    $HF_BIN ($HF_STYLE)"
  echo
  if [ "$HF_STYLE" = "new" ]; then
    "$HF_BIN" download "$QWEN3_REPO" --local-dir "$QWEN3_DIR"
  else
    "$HF_BIN" download "$QWEN3_REPO" \
      --local-dir "$QWEN3_DIR" \
      --local-dir-use-symlinks False
  fi
  echo
  section "İndirme tamam — cold smoke"
  echo "Önce mevcut MLX'i etkilemeden mlx_lm.generate ile tek atış:"
  echo "(RAM'i Activity Monitor'den oku → cold baseline'ı not et)"
  echo
  python3 -c "import mlx_lm; print('mlx_lm OK', mlx_lm.__version__ if hasattr(mlx_lm,'__version__') else '')" 2>&1 | head -3
  echo
  echo "Smoke komutu (manuel çalıştır):"
  echo "  python3 -m mlx_lm.generate --model \"$QWEN3_DIR\" --prompt 'selam' --max-tokens 16"
  ;;

--seed-disabled)
  section "DB seed: $QWEN3_ID (status=offline, is_default=false)"

  # Qwen3 önerilen sampling — non-thinking modu için (presence_penalty=0,
  # repetition_penalty=1.05). UI'dan üzerine yazılabilir.
  PARAMS_JSON=$(cat <<'JSON'
[
  {"key":"temperature","value":0.7},
  {"key":"top_p","value":0.8},
  {"key":"top_k","value":20},
  {"key":"min_p","value":0},
  {"key":"repetition_penalty","value":1.05},
  {"key":"max_tokens","value":2000}
]
JSON
  )

  STOP_JSON='["<|im_end|>","<|endoftext|>"]'
  KWARGS_JSON='{"enable_thinking":false}'
  PREFIX='/no_think
'

  psql_p "$(cat <<SQL
INSERT INTO models (
  id, model_name, provider, base_url, context_length,
  system_prompt, params, is_default, status, source, is_system,
  rag_enabled, template_family, prompt_prefix, stop_sequences, chat_template_kwargs,
  updated_at
) VALUES (
  '$QWEN3_ID',
  '$QWEN3_NAME',
  'MLX',
  'http://127.0.0.1:8001/v1',
  32768,
  '',
  '$PARAMS_JSON'::jsonb,
  false,
  'offline',
  'manual',
  false,
  true,
  'qwen2.5',
  \$\$$PREFIX\$\$,
  '$STOP_JSON'::jsonb,
  '$KWARGS_JSON'::jsonb,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  model_name = EXCLUDED.model_name,
  template_family = EXCLUDED.template_family,
  prompt_prefix = EXCLUDED.prompt_prefix,
  stop_sequences = EXCLUDED.stop_sequences,
  chat_template_kwargs = EXCLUDED.chat_template_kwargs,
  params = EXCLUDED.params,
  rag_enabled = EXCLUDED.rag_enabled,
  updated_at = now();
SQL
  )"
  echo
  echo "Seed tamam. Snapshot:"
  psql_p "SELECT id, status, is_default, template_family, prompt_prefix, stop_sequences, chat_template_kwargs FROM models WHERE id='$QWEN3_ID';"
  ;;

--activate)
  section "Aktivasyon: Qwen2.5 → offline · Qwen3 → ready+is_default"

  # Qwen3 dosyaları diskte var mı?
  if [ ! -f "$QWEN3_DIR/config.json" ]; then
    echo "HATA: $QWEN3_DIR/config.json yok. Önce --download çalıştır."
    exit 1
  fi
  # DB satırı seed edildi mi?
  exists=$(psql_q "SELECT 1 FROM models WHERE id='$QWEN3_ID' LIMIT 1")
  if [ "$exists" != "1" ]; then
    echo "HATA: $QWEN3_ID DB'de yok. Önce --seed-disabled çalıştır."
    exit 1
  fi

  psql_p "$(cat <<SQL
BEGIN;
UPDATE models SET is_default=false WHERE is_default=true;
UPDATE models SET status='offline' WHERE id LIKE '$QWEN25_ID_PREFIX%';
UPDATE models SET status='ready', is_default=true, updated_at=now() WHERE id='$QWEN3_ID';
-- Boot fallback: runtime.default_model'i Qwen3'e çevir (app_settings)
UPDATE app_settings
   SET value = jsonb_set(COALESCE(value,'{}'::jsonb), '{default_model}', to_jsonb('$QWEN3_ID'::text))
 WHERE key = 'runtime.provider';
COMMIT;
SQL
  )"
  echo
  echo "Snapshot:"
  psql_p "SELECT id, status, is_default FROM models ORDER BY is_default DESC, updated_at DESC;"
  echo
  echo "SONRAKİ ADIM (manuel):"
  echo "  1. UI: /system-engine → 'Restart MLX' butonu"
  echo "  2. Activity Monitor: PID 8001 owner Python RSS not et (cold baseline)"
  echo "  3. Smoke: selam · FortiGate VPN sorusu · @[netsec-incident-responder.py]"
  ;;

--rollback)
  section "Rollback: Qwen3 → offline · Qwen2.5 → ready+is_default"
  psql_p "$(cat <<SQL
BEGIN;
UPDATE models SET is_default=false WHERE is_default=true;
UPDATE models SET status='offline' WHERE id='$QWEN3_ID';
UPDATE models SET status='ready', is_default=true, updated_at=now()
 WHERE id LIKE '$QWEN25_ID_PREFIX%'
 ORDER BY updated_at DESC LIMIT 1;
COMMIT;
SQL
  )"
  echo
  psql_p "SELECT id, status, is_default FROM models ORDER BY is_default DESC, updated_at DESC;"
  echo "Restart MLX'i UI'dan tetikle."
  ;;

--migrate-agents)
  section "Ajan brain'leri: qwen2.5-32b* | elara-72b-mlx → $QWEN3_ID"

  BACKUP_DIR="${HOME}/elara-backups"
  mkdir -p "$BACKUP_DIR"
  SNAP="$BACKUP_DIR/agent-brains-$(date +%Y%m%d-%H%M%S).csv"

  echo "Snapshot → $SNAP"
  psql -d "$DB" -c "COPY (SELECT id, name, COALESCE(model,'') AS model FROM agents ORDER BY name) TO STDOUT WITH CSV HEADER" > "$SNAP"
  wc -l "$SNAP"

  echo
  echo "Before:"
  psql_p "SELECT COALESCE(NULLIF(model,''),'(null)') AS brain, count(*) FROM agents GROUP BY 1 ORDER BY 2 DESC;"

  echo
  echo "Migrating (qwen2.5-32b* + elara-72b-mlx rows; diğer brain'ler — Gemini vs. — atlanır)..."
  AFFECTED=$(psql_q "WITH upd AS (
    UPDATE agents
       SET model = '$QWEN3_ID',
           updated_at = now()
     WHERE COALESCE(model,'') LIKE '$QWEN25_ID_PREFIX%'
        OR COALESCE(model,'') = 'elara-72b-mlx'
     RETURNING 1)
    SELECT count(*) FROM upd;")
  echo "Etkilenen satır: $AFFECTED"


  echo
  echo "After:"
  psql_p "SELECT COALESCE(NULLIF(model,''),'(null)') AS brain, count(*) FROM agents GROUP BY 1 ORDER BY 2 DESC;"

  echo
  echo "Rollback gerekirse:"
  echo "  bash $0 --restore-agents $SNAP"
  ;;

--restore-agents)
  CSV="${2:-}"
  [ -f "$CSV" ] || { echo "HATA: snapshot CSV bulunamadı: $CSV"; exit 1; }
  section "Restore: $CSV"

  STAGE="_agent_brain_restore_$$"
  psql -d "$DB" <<SQL
BEGIN;
CREATE TEMP TABLE $STAGE (id text, name text, model text) ON COMMIT DROP;
\copy $STAGE FROM '$CSV' WITH CSV HEADER
SELECT count(*) AS rows_in_csv FROM $STAGE;
UPDATE agents a
   SET model = NULLIF(s.model, ''),
       updated_at = now()
  FROM $STAGE s
 WHERE a.id::text = s.id;
COMMIT;
SQL

  echo
  echo "After restore:"
  psql_p "SELECT COALESCE(NULLIF(model,''),'(null)') AS brain, count(*) FROM agents GROUP BY 1 ORDER BY 2 DESC;"
  ;;

--status)
  section "Models snapshot"
  psql_p "SELECT id, status, is_default, template_family, COALESCE(NULLIF(prompt_prefix,''),'(none)') AS prompt_prefix, stop_sequences, chat_template_kwargs, updated_at FROM models ORDER BY is_default DESC, updated_at DESC;"
  echo
  section "Agent brain dağılımı"
  psql_p "SELECT COALESCE(NULLIF(model,''),'(null)') AS brain, count(*) FROM agents GROUP BY 1 ORDER BY 2 DESC;"
  echo
  section "Disk durumu"
  if [ -d "$QWEN3_DIR" ]; then
    du -sh "$QWEN3_DIR" 2>/dev/null
    ls "$QWEN3_DIR" 2>/dev/null | head -5
  else
    echo "Qwen3 indirilmemiş: $QWEN3_DIR yok."
  fi
  ;;


*)
  echo "Kullanım: $0 [--download|--seed-disabled|--activate|--rollback|--migrate-agents|--restore-agents <csv>|--status]"
  exit 1
  ;;
esac

