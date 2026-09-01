#!/usr/bin/env bash
# agent-auto-route-smoke.sh — CLI gate for Elara → agent auto-routing.
#
# What it proves:
#   1) /api/rag/settings really persists agentAutoRoute=true.
#   2) /api/agents exposes active/armed/idle disk agents with agent_path.
#   3) The pure picker (local-server/lib/user-agent-intent.mjs) chooses an agent.
#   4) /api/chat/stream and /api/chat/orchestrate emit auto-route evidence.
#
# Usage:
#   ELARA_USERNAME=admin ELARA_PASSWORD='***' bash local-server/scripts/agent-auto-route-smoke.sh
#   bash local-server/scripts/agent-auto-route-smoke.sh "fortigatede ha nasıl yapılır?"
#
# Useful env:
#   ELARA_BASE=http://127.0.0.1:3005
#   ROUTES=stream              # stream | orchestrate | both
#   AGENT_MIN_SCORE=1          # temporarily force lower route threshold through API
#   NO_MUTATE=1                # do not POST settings, only observe current state
#   NO_AUTH=1                  # skip login/session headers

set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BASE="${ELARA_BASE:-http://127.0.0.1:3005}"
PROVIDER="${ELARA_PROVIDER:-local}"
ROUTES="${ROUTES:-both}"
CURL_MAX_TIME="${CURL_MAX_TIME:-220}"
AGENT_MIN_SCORE="${AGENT_MIN_SCORE:-1}"
NO_MUTATE="${NO_MUTATE:-0}"
NO_AUTH="${NO_AUTH:-0}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${OUT_DIR:-/tmp/elara-agent-auto-route-${TS}}"
SUMMARY="$OUT_DIR/summary.txt"
mkdir -p "$OUT_DIR"
: > "$SUMMARY"

PROMPTS=("$@")
if [ ${#PROMPTS[@]} -eq 0 ]; then
  PROMPTS=("fortigatede ha nasıl yapılır?" "firewall policy nasıl yazılır?")
fi

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "!! missing dependency: $1" | tee -a "$SUMMARY" >&2; exit 2; }
}
need curl
need jq
need node

log() { printf '%s\n' "$*" | tee -a "$SUMMARY"; }
section() { printf '\n=== %s ===\n' "$*" | tee -a "$SUMMARY"; }

curl_base() {
  curl -sk --connect-timeout 8 --max-time "$CURL_MAX_TIME" "$@"
}

auth_curl() {
  if [ "$NO_AUTH" = "1" ]; then
    curl_base "$@"
  else
    curl_base -H "X-Session-Id: ${SESSION_ID:-}" -H "X-User: ${USERNAME:-}" "$@"
  fi
}

json_get() {
  local file="$1" expr="$2" fallback="${3:-}"
  jq -r "$expr // \"$fallback\"" "$file" 2>/dev/null || printf '%s' "$fallback"
}

section "0. Config"
log "base=$BASE"
log "routes=$ROUTES"
log "out_dir=$OUT_DIR"
log "prompts=${#PROMPTS[@]}"
log "no_mutate=$NO_MUTATE no_auth=$NO_AUTH agent_min_score=$AGENT_MIN_SCORE"

if [ "$NO_AUTH" != "1" ]; then
  USERNAME="${ELARA_USERNAME:-}"
  PASSWORD="${ELARA_PASSWORD:-}"
  if [ -z "$USERNAME" ]; then
    printf 'Elara kullanıcı adı: ' >&2
    read -r USERNAME
  fi
  if [ -z "$PASSWORD" ]; then
    printf 'Elara parola (%s): ' "$USERNAME" >&2
    stty -echo 2>/dev/null
    read -r PASSWORD
    stty echo 2>/dev/null
    printf '\n' >&2
  fi
  if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
    log "!! username/password boş"
    exit 1
  fi

  section "1. Login"
  LOGIN_PAYLOAD=$(jq -nc --arg u "$USERNAME" --arg p "$PASSWORD" --arg pr "$PROVIDER" \
    '{username:$u,password:$p,provider:$pr,device:"agent-auto-route-smoke"}')
  LOGIN_JSON="$OUT_DIR/login.json"
  curl_base -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "$LOGIN_PAYLOAD" > "$LOGIN_JSON"
  SESSION_ID=$(json_get "$LOGIN_JSON" '.sessionId' '')
  if [ -z "$SESSION_ID" ]; then
    log "!! login failed: $(cat "$LOGIN_JSON")"
    exit 1
  fi
  log "session_id=$SESSION_ID"
else
  section "1. Login skipped"
fi

section "2. RAG settings: read → enable via API → readback"
SETTINGS_BEFORE="$OUT_DIR/rag-settings.before.json"
SETTINGS_AFTER="$OUT_DIR/rag-settings.after.json"
auth_curl "$BASE/api/rag/settings" > "$SETTINGS_BEFORE"
log "before.agentAutoRoute=$(json_get "$SETTINGS_BEFORE" '.settings.agentAutoRoute' 'null')"
log "before.agentAutoRouteMinScore=$(json_get "$SETTINGS_BEFORE" '.settings.agentAutoRouteMinScore' 'null')"
log "before.skipOuterLlmOnAgentRewrite=$(json_get "$SETTINGS_BEFORE" '.settings.skipOuterLlmOnAgentRewrite' 'null')"

if [ "$NO_MUTATE" != "1" ]; then
  POST_SETTINGS="$OUT_DIR/rag-settings.post.json"
  SETTINGS_PAYLOAD=$(jq -nc --argjson score "$AGENT_MIN_SCORE" \
    '{agentAutoRoute:true,agentAutoRouteMinScore:$score,skipOuterLlmOnAgentRewrite:true,streamAgentExec:true}')
  auth_curl -X POST "$BASE/api/rag/settings" -H 'Content-Type: application/json' -d "$SETTINGS_PAYLOAD" > "$POST_SETTINGS"
  log "post.ok=$(json_get "$POST_SETTINGS" '.ok' 'false')"
fi

auth_curl "$BASE/api/rag/settings" > "$SETTINGS_AFTER"
AUTO_ON=$(json_get "$SETTINGS_AFTER" '.settings.agentAutoRoute' 'false')
MIN_SCORE=$(json_get "$SETTINGS_AFTER" '.settings.agentAutoRouteMinScore' "$AGENT_MIN_SCORE")
log "after.agentAutoRoute=$AUTO_ON"
log "after.agentAutoRouteMinScore=$MIN_SCORE"
log "after.skipOuterLlmOnAgentRewrite=$(json_get "$SETTINGS_AFTER" '.settings.skipOuterLlmOnAgentRewrite' 'null')"

if [ "$AUTO_ON" != "true" ]; then
  log "FAIL settings: agentAutoRoute is not true. UI/API persistence is still broken."
  exit 10
fi

section "3. Agents inventory"
AGENTS_JSON="$OUT_DIR/agents.json"
auth_curl "$BASE/api/agents" > "$AGENTS_JSON"
AGENT_COUNT=$(jq 'if type=="array" then length else 0 end' "$AGENTS_JSON" 2>/dev/null || echo 0)
ROUTABLE_COUNT=$(jq '[.[]? | select((.agent_path // .agentPath // .meta.agentPath // .meta.script // "") != "") | select(((.status // "") | ascii_downcase) as $s | ($s=="active" or $s=="armed" or $s=="idle"))] | length' "$AGENTS_JSON" 2>/dev/null || echo 0)
log "agents.total=$AGENT_COUNT"
log "agents.routable=$ROUTABLE_COUNT"
jq -r '.[]? | select((.agent_path // .agentPath // .meta.agentPath // .meta.script // "") != "") | "- \(.name // .id) status=\(.status // "?") path=\(.agent_path // .agentPath // .meta.agentPath // .meta.script // "?") tags=\((.meta.tags // [])|join(",")) brands=\((.meta.rag.brands // [])|join(",")) keywords=\((.meta.rag.keywords // [])|join(","))"' "$AGENTS_JSON" | tee -a "$SUMMARY"
if [ "$ROUTABLE_COUNT" -lt 1 ]; then
  log "FAIL agents: no active/armed/idle agent with agent_path. Auto-route has nothing to pick."
  exit 11
fi

section "4. Pure picker score (no chat, no MLX)"
SCORE_SCRIPT="$OUT_DIR/score-agents.mjs"
cat > "$SCORE_SCRIPT" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot, agentsFile, minScoreRaw, ...prompts] = process.argv.slice(2);
const { pickAgentForQuery } = await import(pathToFileURL(path.join(repoRoot, 'local-server/lib/user-agent-intent.mjs')).href);
const rows = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
const minScore = Number(minScoreRaw || 1);
let failed = 0;
for (const prompt of prompts) {
  const pick = pickAgentForQuery(prompt, rows, { minScore });
  if (!pick) {
    failed += 1;
    console.log(JSON.stringify({ ok:false, prompt, reason:'no_pick', minScore }));
  } else {
    console.log(JSON.stringify({
      ok:true,
      prompt,
      script: pick.script,
      name: pick.row?.name || null,
      score: pick.score,
      matchedToken: pick.matchedToken,
      hits: pick.hits || []
    }));
  }
}
process.exit(failed ? 1 : 0);
NODE

PICKER_NDJSON="$OUT_DIR/picker.ndjson"
node "$SCORE_SCRIPT" "$REPO_ROOT" "$AGENTS_JSON" "$MIN_SCORE" "${PROMPTS[@]}" > "$PICKER_NDJSON"
PICK_RC=$?
jq -r 'if .ok then "PASS picker: \(.prompt) -> \(.script) score=\(.score) token=\(.matchedToken) hits=\((.hits|map(.kind+":"+.token)|join(",")))" else "FAIL picker: \(.prompt) -> no_pick minScore=\(.minScore)" end' "$PICKER_NDJSON" | tee -a "$SUMMARY"
if [ "$PICK_RC" -ne 0 ]; then
  log "FAIL picker: metadata does not match prompt. Add brands/keywords/tags in the agent UI or lower agentAutoRouteMinScore."
  exit 12
fi

make_thread() {
  local title="$1"
  local th_json="$OUT_DIR/thread-${title}.json"
  auth_curl -X POST "$BASE/api/threads" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg t "$title" '{title:$t}')" > "$th_json"
  json_get "$th_json" '.id' ''
}

run_route_prompt() {
  local route="$1" idx="$2" prompt="$3"
  local label="${route}-${idx}"
  local thread_id trace_id endpoint body raw frames metrics trace_a trace_b
  thread_id=$(make_thread "agent-auto-${label}-${TS}")
  if [ -z "$thread_id" ]; then
    log "FAIL $label: thread create failed"
    return 1
  fi
  trace_id="agent-auto-${TS}-${label}"
  raw="$OUT_DIR/${label}.sse"
  frames="$OUT_DIR/${label}.frames.ndjson"
  metrics="$OUT_DIR/${label}.metrics.json"
  trace_a="$OUT_DIR/${label}.trace-primary.txt"
  trace_b="$OUT_DIR/${label}.trace-thread.txt"

  if [ "$route" = "orchestrate" ]; then
    endpoint="/api/chat/orchestrate"
    body=$(jq -nc --arg tid "$thread_id" --arg trace "$trace_id" --arg q "$prompt" '{traceId:$trace,thread_id:$tid,threadId:$tid,model:(env.ELARA_MODEL // "elara-72b-mlx"),mode:"local",locale:"tr",useRag:true,userRole:"Admin",message:$q,messages:[{role:"user",content:$q}]}')
  else
    endpoint="/api/chat/stream"
    body=$(jq -nc --arg tid "$thread_id" --arg trace "$trace_id" --arg q "$prompt" '{traceId:$trace,thread_id:$tid,threadId:$tid,model:(env.ELARA_MODEL // "elara-72b-mlx"),mode:"local",locale:"tr",useRag:true,userRole:"Admin",messages:[{role:"user",content:$q}]}')
  fi

  local t0 t1 elapsed
  t0=$(date +%s)
  auth_curl -N -X POST "$BASE$endpoint" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' -d "$body" > "$raw" 2>&1
  t1=$(date +%s)
  elapsed=$((t1 - t0))
  sed -n 's/^data: //p' "$raw" | grep -E '^\{' > "$frames" || true

  jq -s '{
    frames:length,
    autoEvent: ([.[] | select(.agent.autoRouted==true) | .agent][0] // null),
    phaseAgentDispatch: ([.[] | select(.phase=="agent_dispatch")] | length > 0),
    agentThinking: ([.[] | select(.type=="agent_thinking" or .key=="agent.thinking")] | length > 0),
    agentChunkChars: ([.[] | select(.type=="agent_chunk") | (.delta // "")] | join("") | length),
    deltaChars: ([.[] | select(.delta != null) | .delta] | join("") | length),
    errors: [.[] | select(.error != null) | .error]
  }' "$frames" > "$metrics" 2>/dev/null || echo '{"frames":0,"autoEvent":null,"phaseAgentDispatch":false,"agentThinking":false,"agentChunkChars":0,"deltaChars":0,"errors":["frame_parse_failed"]}' > "$metrics"

  auth_curl "$BASE/api/debug/chat/$trace_id?format=text" > "$trace_a" 2>/dev/null || true
  auth_curl "$BASE/api/debug/chat/$thread_id?format=text" > "$trace_b" 2>/dev/null || true
  local trace_auto="false" trace_bridge="false"
  grep -q 'agent.auto_route' "$trace_a" "$trace_b" 2>/dev/null && trace_auto="true"
  grep -q 'agent.bridge.start' "$trace_a" "$trace_b" 2>/dev/null && trace_bridge="true"

  local auto_json phase_dispatch agent_thinking agent_chunk_chars delta_chars frames_count errors pass
  auto_json=$(jq -c '.autoEvent' "$metrics")
  phase_dispatch=$(json_get "$metrics" '.phaseAgentDispatch' 'false')
  agent_thinking=$(json_get "$metrics" '.agentThinking' 'false')
  agent_chunk_chars=$(json_get "$metrics" '.agentChunkChars' '0')
  delta_chars=$(json_get "$metrics" '.deltaChars' '0')
  frames_count=$(json_get "$metrics" '.frames' '0')
  errors=$(jq -c '.errors' "$metrics" 2>/dev/null || echo '[]')

  pass="false"
  if [ "$auto_json" != "null" ] || [ "$trace_auto" = "true" ]; then
    pass="true"
  fi

  log ""
  log "[$label] endpoint=$endpoint elapsed=${elapsed}s frames=$frames_count thread=$thread_id trace=$trace_id"
  log "[$label] prompt=$prompt"
  log "[$label] autoEvent=$auto_json traceAuto=$trace_auto phaseAgentDispatch=$phase_dispatch traceBridge=$trace_bridge agentThinking=$agent_thinking agentChunkChars=$agent_chunk_chars deltaChars=$delta_chars errors=$errors"
  log "[$label] raw=$raw"
  log "[$label] tracePrimary=$trace_a traceThread=$trace_b"

  if [ "$pass" = "true" ]; then
    log "PASS $label: auto-route fired"
    return 0
  fi
  log "FAIL $label: no auto-route event/trace. This request stayed on Elara instead of delegating."
  return 1
}

section "5. Chat route smoke"
FAILS=0
idx=0
for prompt in "${PROMPTS[@]}"; do
  idx=$((idx + 1))
  case "$ROUTES" in
    stream)
      run_route_prompt stream "$idx" "$prompt" || FAILS=$((FAILS + 1))
      ;;
    orchestrate)
      run_route_prompt orchestrate "$idx" "$prompt" || FAILS=$((FAILS + 1))
      ;;
    both)
      run_route_prompt stream "$idx" "$prompt" || FAILS=$((FAILS + 1))
      run_route_prompt orchestrate "$idx" "$prompt" || FAILS=$((FAILS + 1))
      ;;
    *)
      log "!! invalid ROUTES=$ROUTES (use stream|orchestrate|both)"
      exit 2
      ;;
  esac
done

section "DONE"
log "summary=$SUMMARY"
log "raw_dir=$OUT_DIR"
if [ "$FAILS" -gt 0 ]; then
  log "RESULT=FAIL fails=$FAILS"
  exit 20
fi
log "RESULT=PASS"