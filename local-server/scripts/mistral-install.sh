#!/usr/bin/env bash
# mistral-install.sh — Mistral-Small-3.1-24B-Instruct-6bit yan-yana kurulum
#
# Mode'lar:
#   --download       : ~/models/Mistral-Small-3.1-24B-Instruct-6bit'e indir (~18GB)
#   --seed-disabled  : DB'ye mistral satırı ekle, status='offline', is_default=false
#                      (template_family=mistral, stop=["</s>","[INST]"],
#                       Mistral önerilen sampling temp=0.3 top_p=0.95)
#   --activate       : Aktif default'u offline'a al, Mistral'ı ready+is_default yap
#                      (idempotent; MLX restart YAPMAZ — UI'dan tetikle)
#   --rollback       : Mistral'ı offline'a al, Qwen3-32B-4bit'i ready+is_default yap
#   --status         : Models tablosu + disk durumu
#
# Default: --status. İndirme + seed + activate KESİNLİKLE manuel onayla.
#
# DB: $DB_NAME (default elara_db) · psql local socket
# Model dir: $MODELS_DIR (default ~/models)

set -euo pipefail

DB="${DB_NAME:-elara_db}"
MODELS_DIR="${MODELS_DIR:-$HOME/models}"
MODE="${1:---status}"

MISTRAL_REPO="mlx-community/Mistral-Small-3.1-24B-Instruct-2503-6bit"
MISTRAL_ID="mistral-small-3.1-24b-6bit"
MISTRAL_NAME="Mistral-Small-3.1-24B-Instruct-6bit"
MISTRAL_DIR="$MODELS_DIR/Mistral-Small-3.1-24B-Instruct-6bit"

QWEN3_ID="qwen3-32b-4bit"  # rollback hedefi

psql_q() { psql -d "$DB" -At -c "$1"; }
psql_p() { psql -d "$DB" -c "$1"; }

hr() { printf '%s\n' "------------------------------------------------------------"; }
section() { echo; hr; echo "==> $1"; hr; }

# ----------------------------------------------------------------------------
case "$MODE" in

--download)
  section "Mistral-Small-3.1-24B-Instruct-6bit indirme (~18GB)"
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
  echo "Repo:   $MISTRAL_REPO"
  echo "Hedef:  $MISTRAL_DIR"
  echo "CLI:    $HF_BIN ($HF_STYLE)"
  echo
  if [ "$HF_STYLE" = "new" ]; then
    "$HF_BIN" download "$MISTRAL_REPO" --local-dir "$MISTRAL_DIR"
  else
    "$HF_BIN" download "$MISTRAL_REPO" \
      --local-dir "$MISTRAL_DIR" \
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
  echo "  python3 -m mlx_lm.generate --model \"$MISTRAL_DIR\" --prompt 'selam' --max-tokens 16"
  ;;

--seed-disabled)
  section "DB seed: $MISTRAL_ID (status=offline, is_default=false)"

  # Mistral önerilen sampling (Small 3.x ailesi düşük penalty sever,
  # repetition_penalty=1.0 — Mistral docs).
  PARAMS_JSON=$(cat <<'JSON'
[
  {"key":"temperature","value":0.3},
  {"key":"top_p","value":0.95},
  {"key":"top_k","value":64},
  {"key":"min_p","value":0},
  {"key":"repetition_penalty","value":1.0},
  {"key":"max_tokens","value":2000}
]
JSON
  )

  STOP_JSON='["</s>","[INST]"]'
  KWARGS_JSON='{}'
  # Mistral'da /no_think yok, think-chain yok → prompt_prefix boş.

  psql_p "$(cat <<SQL
INSERT INTO models (
  id, model_name, provider, base_url, context_length,
  system_prompt, params, is_default, status, source, is_system,
  rag_enabled, template_family, prompt_prefix, stop_sequences, chat_template_kwargs,
  updated_at
) VALUES (
  '$MISTRAL_ID',
  '$MISTRAL_NAME',
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
  'mistral',
  '',
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
  psql_p "SELECT id, status, is_default, template_family, prompt_prefix, stop_sequences, chat_template_kwargs FROM models WHERE id='$MISTRAL_ID';"
  ;;

--activate)
  section "Aktivasyon: aktif default → offline · $MISTRAL_ID → ready+is_default"

  if [ ! -f "$MISTRAL_DIR/config.json" ]; then
    echo "HATA: $MISTRAL_DIR/config.json yok. Önce --download çalıştır."
    exit 1
  fi
  exists=$(psql_q "SELECT 1 FROM models WHERE id='$MISTRAL_ID' LIMIT 1")
  if [ "$exists" != "1" ]; then
    echo "HATA: $MISTRAL_ID DB'de yok. Önce --seed-disabled çalıştır."
    exit 1
  fi

  psql_p "$(cat <<SQL
BEGIN;
UPDATE models SET status='offline' WHERE is_default=true AND id<>'$MISTRAL_ID';
UPDATE models SET is_default=false WHERE is_default=true AND id<>'$MISTRAL_ID';
UPDATE models SET status='ready', is_default=true, updated_at=now() WHERE id='$MISTRAL_ID';
UPDATE app_settings
   SET value = jsonb_set(COALESCE(value,'{}'::jsonb), '{default_model}', to_jsonb('$MISTRAL_ID'::text))
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
  echo "  3. Smoke: Test Connection selamı (Hello, I'm here · …) · </s> / [INST] sızıntı YOK"
  echo "  4. RAG turu: tek FortiGate sorusu · cevap kalite + loop yok"
  echo "  5. Loop guard testi: kasıtlı uzun nonsense → guard tetiklenmedi"
  ;;

--rollback)
  section "Rollback: $MISTRAL_ID → offline · $QWEN3_ID → ready+is_default"
  psql_p "$(cat <<SQL
BEGIN;
UPDATE models SET is_default=false WHERE is_default=true;
UPDATE models SET status='offline' WHERE id='$MISTRAL_ID';
UPDATE models SET status='ready', is_default=true, updated_at=now()
 WHERE id='$QWEN3_ID';
UPDATE app_settings
   SET value = jsonb_set(COALESCE(value,'{}'::jsonb), '{default_model}', to_jsonb('$QWEN3_ID'::text))
 WHERE key = 'runtime.provider';
COMMIT;
SQL
  )"
  echo
  psql_p "SELECT id, status, is_default FROM models ORDER BY is_default DESC, updated_at DESC;"
  echo "Restart MLX'i UI'dan tetikle."
  ;;

--status)
  section "Models snapshot"
  psql_p "SELECT id, status, is_default, template_family, COALESCE(NULLIF(prompt_prefix,''),'(none)') AS prompt_prefix, stop_sequences, chat_template_kwargs, updated_at FROM models ORDER BY is_default DESC, updated_at DESC;"
  echo
  section "Disk durumu"
  if [ -d "$MISTRAL_DIR" ]; then
    du -sh "$MISTRAL_DIR" 2>/dev/null
    ls "$MISTRAL_DIR" 2>/dev/null | head -5
  else
    echo "Mistral indirilmemiş: $MISTRAL_DIR yok."
  fi
  ;;

*)
  echo "Kullanım: $0 [--download|--seed-disabled|--activate|--rollback|--status]"
  exit 1
  ;;
esac
