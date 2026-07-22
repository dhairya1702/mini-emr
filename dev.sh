#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_ENV_FILE="$ROOT_DIR/.env"

python3 "$ROOT_DIR/scripts/validate-env.py" "$DEV_ENV_FILE" "$ROOT_DIR/backend/.env"

if [[ -f "$DEV_ENV_FILE" ]]; then
  set -a
  source "$DEV_ENV_FILE"
  set +a
fi

BACKEND_DIR="$ROOT_DIR/backend"
WEB_DIR="$ROOT_DIR/web"
BACKEND_VENV="$BACKEND_DIR/.venv"
BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8001"
BACKEND_HEALTH_URL="http://$BACKEND_HOST:$BACKEND_PORT/health/live"
BACKEND_STARTUP_TIMEOUT_SECONDS="${BACKEND_STARTUP_TIMEOUT_SECONDS:-20}"
BACKEND_RELOAD="${BACKEND_RELOAD:-0}"
SHUTDOWN_GRACE_SECONDS="${SHUTDOWN_GRACE_SECONDS:-5}"
CLOUD_SQL_PROXY_ENABLED="${CLOUD_SQL_PROXY_ENABLED:-0}"
CLOUD_SQL_CONNECTION_NAME="${CLOUD_SQL_CONNECTION_NAME:-}"
CLOUD_SQL_PROXY_BIN="${CLOUD_SQL_PROXY_BIN:-cloud-sql-proxy}"
CLOUD_SQL_PROXY_PORT="${CLOUD_SQL_PROXY_PORT:-5433}"
NGROK_ENABLED="${NGROK_ENABLED:-1}"
NGROK_BIN="${NGROK_BIN:-ngrok}"
NGROK_URL="${NGROK_URL:-https://terrell-unrightful-belinda.ngrok-free.dev}"
NGROK_API_URL="${NGROK_API_URL:-http://127.0.0.1:4040/api/tunnels}"
NGROK_STARTUP_TIMEOUT_SECONDS="${NGROK_STARTUP_TIMEOUT_SECONDS:-15}"
NGROK_SEPARATE_TERMINAL="${NGROK_SEPARATE_TERMINAL:-0}"
NGROK_PID_FILE="${NGROK_PID_FILE:-/tmp/clinic-emr-ngrok.pid}"
WHATSAPP_SKIP_SIGNATURE_CHECK="${WHATSAPP_SKIP_SIGNATURE_CHECK:-1}"

if [[ ! -d "$BACKEND_VENV" ]]; then
  python3 -m venv "$BACKEND_VENV"
fi

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ -n "${PROXY_PID:-}" ]]; then
    kill "$PROXY_PID" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "${NGROK_PID:-}" ]]; then
    kill "$NGROK_PID" 2>/dev/null || true
  fi
  if [[ -n "${NGROK_PID_FILE:-}" && -f "$NGROK_PID_FILE" ]]; then
    local file_pid
    file_pid="$(cat "$NGROK_PID_FILE" 2>/dev/null || true)"
    if [[ "$file_pid" =~ ^[0-9]+$ ]]; then
      kill "$file_pid" 2>/dev/null || true
    fi
    rm -f "$NGROK_PID_FILE"
  fi
  local deadline=$((SECONDS + SHUTDOWN_GRACE_SECONDS))
  while (( SECONDS < deadline )); do
    local proxy_alive=0
    local backend_alive=0
    local web_alive=0
    local ngrok_alive=0
    if [[ -n "${PROXY_PID:-}" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
      proxy_alive=1
    fi
    if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
      backend_alive=1
    fi
    if [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
      web_alive=1
    fi
    if [[ -n "${NGROK_PID:-}" ]] && kill -0 "$NGROK_PID" 2>/dev/null; then
      ngrok_alive=1
    fi
    if [[ "$ngrok_alive" == "0" && -n "${NGROK_PID_FILE:-}" && -f "$NGROK_PID_FILE" ]]; then
      local file_pid
      file_pid="$(cat "$NGROK_PID_FILE" 2>/dev/null || true)"
      if [[ "$file_pid" =~ ^[0-9]+$ ]] && kill -0 "$file_pid" 2>/dev/null; then
        ngrok_alive=1
      fi
    fi
    if [[ "$proxy_alive" == "0" && "$backend_alive" == "0" && "$web_alive" == "0" && "$ngrok_alive" == "0" ]]; then
      break
    fi
    sleep 1
  done
  if [[ -n "${PROXY_PID:-}" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill -9 "$PROXY_PID" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill -9 "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill -9 "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "${NGROK_PID:-}" ]] && kill -0 "$NGROK_PID" 2>/dev/null; then
    kill -9 "$NGROK_PID" 2>/dev/null || true
  fi
  if [[ -n "${NGROK_PID_FILE:-}" && -f "$NGROK_PID_FILE" ]]; then
    local file_pid
    file_pid="$(cat "$NGROK_PID_FILE" 2>/dev/null || true)"
    if [[ "$file_pid" =~ ^[0-9]+$ ]] && kill -0 "$file_pid" 2>/dev/null; then
      kill -9 "$file_pid" 2>/dev/null || true
    fi
    rm -f "$NGROK_PID_FILE"
  fi
  wait 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

if [[ "$CLOUD_SQL_PROXY_ENABLED" == "1" ]]; then
  if [[ -z "$CLOUD_SQL_CONNECTION_NAME" ]]; then
    echo "CLOUD_SQL_PROXY_ENABLED=1 requires CLOUD_SQL_CONNECTION_NAME to be set." >&2
    exit 1
  fi
  if ! command -v "$CLOUD_SQL_PROXY_BIN" >/dev/null 2>&1; then
    echo "Cloud SQL proxy binary not found: $CLOUD_SQL_PROXY_BIN" >&2
    exit 1
  fi
  "$CLOUD_SQL_PROXY_BIN" --port "$CLOUD_SQL_PROXY_PORT" "$CLOUD_SQL_CONNECTION_NAME" &
  PROXY_PID=$!
fi

(
  cd "$BACKEND_DIR"
  source "$BACKEND_VENV/bin/activate"
  if [[ "$WHATSAPP_SKIP_SIGNATURE_CHECK" == "1" ]]; then
    export WHATSAPP_APP_SECRET=""
  fi
  if [[ "$BACKEND_RELOAD" == "1" ]]; then
    exec uvicorn app.main:app --reload --host "$BACKEND_HOST" --port "$BACKEND_PORT"
  fi
  exec uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

backend_ready=0
for ((attempt = 1; attempt <= BACKEND_STARTUP_TIMEOUT_SECONDS; attempt += 1)); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend process exited before becoming healthy."
    exit 1
  fi
  if curl -fsS "$BACKEND_HEALTH_URL" >/dev/null 2>&1; then
    backend_ready=1
    break
  fi
  sleep 1
done

if [[ "$backend_ready" != "1" ]]; then
  echo "Backend did not become healthy at $BACKEND_HEALTH_URL within ${BACKEND_STARTUP_TIMEOUT_SECONDS}s."
  exit 1
fi

if [[ "$NGROK_ENABLED" == "1" ]]; then
  if ! command -v "$NGROK_BIN" >/dev/null 2>&1; then
    echo "ngrok binary not found: $NGROK_BIN" >&2
    exit 1
  fi
  if [[ "$NGROK_SEPARATE_TERMINAL" == "1" && "$(uname -s)" != "Darwin" ]]; then
    echo "NGROK_SEPARATE_TERMINAL=1 is only supported on macOS Terminal.app." >&2
    exit 1
  fi
  if [[ "$NGROK_SEPARATE_TERMINAL" == "1" && ! -d "/System/Applications/Utilities/Terminal.app" && ! -d "/Applications/Utilities/Terminal.app" ]]; then
    echo "Terminal.app not found; cannot launch ngrok in a separate tab." >&2
    exit 1
  fi
  ngrok_cmd=("$NGROK_BIN" http "$BACKEND_PORT")
  if [[ -n "$NGROK_URL" ]]; then
    ngrok_cmd+=("--url" "$NGROK_URL")
  fi
  if [[ "$NGROK_SEPARATE_TERMINAL" == "1" ]]; then
    rm -f "$NGROK_PID_FILE"
    ngrok_shell_cmd="cd $(printf '%q' "$ROOT_DIR"); echo \$\$ > $(printf '%q' "$NGROK_PID_FILE"); exec $(printf '%q ' "${ngrok_cmd[@]}")"
    osascript >/dev/null <<OSA
tell application "Terminal"
  activate
  if not (exists window 1) then
    do script "$(printf '%s' "$ngrok_shell_cmd" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  else
    tell application "System Events" to keystroke "t" using command down
    delay 0.2
    do script "$(printf '%s' "$ngrok_shell_cmd" | sed 's/\\/\\\\/g; s/"/\\"/g')" in selected tab of front window
  end if
end tell
OSA
    echo "ngrok launched in a separate Terminal tab."
  else
    "${ngrok_cmd[@]}" &
    NGROK_PID=$!
  fi
  ngrok_public_url=""
  for ((attempt = 1; attempt <= NGROK_STARTUP_TIMEOUT_SECONDS; attempt += 1)); do
    if [[ "$NGROK_SEPARATE_TERMINAL" != "1" ]]; then
      if ! kill -0 "$NGROK_PID" 2>/dev/null; then
        echo "ngrok process exited before exposing the backend."
        exit 1
      fi
    fi
    if [[ "$NGROK_SEPARATE_TERMINAL" == "1" && -f "$NGROK_PID_FILE" ]]; then
      NGROK_PID="$(cat "$NGROK_PID_FILE" 2>/dev/null || true)"
      if [[ "$NGROK_PID" =~ ^[0-9]+$ ]] && ! kill -0 "$NGROK_PID" 2>/dev/null; then
        echo "ngrok process exited before exposing the backend."
        exit 1
      fi
    fi
    ngrok_public_url="$(
      python3 - "$NGROK_API_URL" <<'PY' 2>/dev/null || true
import json
import sys
from urllib.request import urlopen

with urlopen(sys.argv[1], timeout=2) as response:
    payload = json.loads(response.read().decode("utf-8"))
for tunnel in payload.get("tunnels", []):
    url = str(tunnel.get("public_url") or "")
    if url.startswith("https://"):
        print(url)
        break
PY
    )"
    if [[ -n "$ngrok_public_url" ]]; then
      echo "ngrok public URL: $ngrok_public_url"
      echo "WhatsApp webhook URL: $ngrok_public_url/webhooks/whatsapp"
      break
    fi
    sleep 1
  done
  if [[ -z "$ngrok_public_url" ]]; then
    echo "ngrok did not expose an HTTPS URL within ${NGROK_STARTUP_TIMEOUT_SECONDS}s."
    exit 1
  fi
fi

(
  cd "$WEB_DIR"
  exec npm run dev
) &
WEB_PID=$!

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  if [[ "$NGROK_ENABLED" == "1" && -n "${NGROK_PID:-}" ]] && ! kill -0 "$NGROK_PID" 2>/dev/null; then
    echo "ngrok process exited."
    exit 1
  fi
  sleep 1
done
