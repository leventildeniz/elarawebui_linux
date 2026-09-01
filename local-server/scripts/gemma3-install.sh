#!/usr/bin/env bash
# gemma3-install.sh — Google Gemma 3 27B-IT (QAT 4bit) yan-yana kurulum
#
# Mode'lar:
#   --download       : ~/models/gemma-3-27b-it-4bit'e indir (~17-18GB QAT 4bit)
#                      Override: GEMMA_REPO env (örn. mlx-community/gemma-3-27b-it-6bit)
#   --seed-disabled  : DB'ye gemma satırı ekle, status='offline', is_default=false
#                      template_family=gemma, stop=["<end_of_turn>","<eos>"]
#                      sampling temp=0.7 top_p=0.95 top_k=64 rep_pen=1.1
#   --activate       : Aktif default'u offline'a al, Gemma'yı ready+is_default yap
#                      (idempotent; MLX restart YAPMAZ — UI'dan tetikle)
#   --rollback       : Gemma'yı offline'a al, varsa Mistral'a yoksa Qwen3'e dön
#   --status         : Models tablosu + disk durumu
#
# Default: --status. İndirme + seed + activate KESİNLİKLE manuel onayla.

set -euo pipefail

DB="${DB_NAME:-elara_db}"
MODELS_DIR="${MODELS_DIR:-$HOME/models}"
MODE="${1:---status}"

GEMMA_REPO="${GEMMA_REPO:-mlx-community/gemma-3-27b-it-qat-4bit}"
GEMMA_ID="gemma-3-27b-it-4bit"
GEMMA_NAME="Gemma-3-27B-IT-QAT-4bit"
GEMMA_DIR="$MODELS_DIR/gemma-3-27b-it-4bit"

MISTRAL_ID="mistral-small-3.1-24b-6bit"
QWEN3_ID="qwen3-32b-4bit"

psql_q() { psql -d "$DB" -At -c "$1"; }
psql_p() { psql -d "$DB" -c "$1"; }

hr() { printf '%s\n' "------------------------------------------------------------"; }
section() { echo; hr; echo "==> $1"; hr; }

case "$MODE" in

--download)
  section "Gemma 3 27B-IT indirme (~17-18GB QAT 4bit)"
  if command -v hf >/dev/null 2>&1; then
    HF_BIN="hf"; HF_STYLE="new"
  elif command -v huggingface-cli >/dev/null 2>&1; then
    HF_BIN="huggingface-cli"; HF_STYLE="old"
  else
    echo "HATA: 'hf' veya 'huggingface-cli' bulunamadi. pip install -U huggingface_hub"
    exit 1
  fi
  mkdir -p "$MODELS_DIR"
  df -h "$MODELS_DIR" | tail -1
  echo
  echo "Repo:   $GEMMA_REPO"
  echo "Hedef:  $GEMMA_DIR"
  echo "CLI:    $HF_BIN ($HF_STYLE)"
  echo
  if [ "$HF_STYLE" = "new" ]; then
    "$HF_BIN" download "$GEMMA_REPO" --local-dir "$GEMMA_DIR"
  else
    "$HF_BIN" download "$GEMMA_REPO" \
      --local-dir "$GEMMA_DIR" \
      --local-dir-use-symlinks False
  fi
  echo
  section "İndirme tamam — cold smoke"
  python3 -c "import mlx_lm; print('mlx_lm OK', getattr(mlx_lm,'__version__','?'))" 2>&1 | head -3
  echo
  echo "Smoke (manuel):"
  echo "  python3 -m mlx_lm.generate --model \"$GEMMA_DIR\" --prompt 'selam' --max-tokens 16"
  ;;

--seed-disabled)
  section "DB seed: $GEMMA_ID (status=offline, is_default=false)"

  PARAMS_JSON=$(cat <<'JSON'
[
  {"key":"temperature","value":0.7},
  {"key":"top_p","value":0.95},
  {"key":"top_k","value":64},
  {"key":"min_p","value":0},
  {"key":"repetition_penalty","value":1.1},
  {"key":"max_tokens","value":2000}
]
JSON
  )

  STOP_JSON='["<end_of_turn>","<eos>"]'
  KWARGS_JSON='{}'

  psql_p "$(cat <<SQL
INSERT INTO models (
  id, model_name, provider, base_url, context_length,
  system_prompt, params, is_default, status, source, is_system,
  rag_enabled, template_family, prompt_prefix, stop_sequences, chat_template_kwargs,
  updated_at
) VALUES (
  '$GEMMA_ID',
  '$GEMMA_NAME',
  'MLX',
  'http://127.0.0.1:8001/v1',
  131072,
  '',
  '$PARAMS_JSON'::jsonb,
  false,
  'offline',
  'manual',
  false,
  true,
  'gemma',
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
  psql_p "SELECT id, status, is_default, template_family, prompt_prefix, stop_sequences, chat_template_kwargs FROM models WHERE id='$GEMMA_ID';"
  ;;

--activate)
  section "Aktivasyon: aktif default → offline · $GEMMA_ID → ready+is_default"

  if [ ! -f "$GEMMA_DIR/config.json" ]; then
    echo "HATA: $GEMMA_DIR/config.json yok. Önce --download çalıştır."
    exit 1
  fi
  exists=$(psql_q "SELECT 1 FROM models WHERE id='$GEMMA_ID' LIMIT 1")
  if [ "$exists" != "1" ]; then
    echo "HATA: $GEMMA_ID DB'de yok. Önce --seed-disabled çalıştır."
    exit 1
  fi

  psql_p "$(cat <<SQL
BEGIN;
UPDATE models SET status='offline' WHERE is_default=true AND id<>'$GEMMA_ID';
UPDATE models SET is_default=false WHERE is_default=true AND id<>'$GEMMA_ID';
UPDATE models SET status='ready', is_default=true, updated_at=now() WHERE id='$GEMMA_ID';
UPDATE app_settings
   SET value = jsonb_set(COALESCE(value,'{}'::jsonb), '{default_model}', to_jsonb('$GEMMA_ID'::text))
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
  echo "  2. Activity Monitor: PID 8001 owner Python RSS not et (cold baseline ~17-18GB)"
  echo "  3. Smoke: Test Connection selamı · <end_of_turn> / <eos> sızıntı YOK"
  echo "  4. SNAT/NAT repro: bugün loop yaşadığın FortiGate sorusu · '1 1 1' patolojisi YOK"
  echo "  5. RAG turu: tek soru · cevap kalite + loop yok + brand-lock korunur"
  ;;

--rollback)
  TARGET="$QWEN3_ID"
  if [ "$(psql_q "SELECT 1 FROM models WHERE id='$MISTRAL_ID' LIMIT 1")" = "1" ]; then
    TARGET="$MISTRAL_ID"
  fi
  section "Rollback: $GEMMA_ID → offline · $TARGET → ready+is_default"
  psql_p "$(cat <<SQL
BEGIN;
UPDATE models SET is_default=false WHERE is_default=true;
UPDATE models SET status='offline' WHERE id='$GEMMA_ID';
UPDATE models SET status='ready', is_default=true, updated_at=now()
 WHERE id='$TARGET';
UPDATE app_settings
   SET value = jsonb_set(COALESCE(value,'{}'::jsonb), '{default_model}', to_jsonb('$TARGET'::text))
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
  if [ -d "$GEMMA_DIR" ]; then
    du -sh "$GEMMA_DIR" 2>/dev/null
    ls "$GEMMA_DIR" 2>/dev/null | head -5
  else
    echo "Gemma indirilmemiş: $GEMMA_DIR yok."
  fi
  ;;

*)
  echo "Kullanım: $0 [--download|--seed-disabled|--activate|--rollback|--status]"
  echo "Env override: GEMMA_REPO=mlx-community/gemma-3-27b-it-6bit $0 --download"
  exit 1
  ;;
esac
