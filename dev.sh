#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
WEB_DIR="$ROOT_DIR/web"
BACKEND_VENV="$BACKEND_DIR/.venv"
BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8001"
BACKEND_HEALTH_URL="http://$BACKEND_HOST:$BACKEND_PORT/health"
BACKEND_STARTUP_TIMEOUT_SECONDS="${BACKEND_STARTUP_TIMEOUT_SECONDS:-20}"
BACKEND_RELOAD="${BACKEND_RELOAD:-0}"
SHUTDOWN_GRACE_SECONDS="${SHUTDOWN_GRACE_SECONDS:-5}"
CLOUD_SQL_PROXY_ENABLED="${CLOUD_SQL_PROXY_ENABLED:-0}"
CLOUD_SQL_CONNECTION_NAME="${CLOUD_SQL_CONNECTION_NAME:-}"
CLOUD_SQL_PROXY_BIN="${CLOUD_SQL_PROXY_BIN:-cloud-sql-proxy}"
CLOUD_SQL_PROXY_PORT="${CLOUD_SQL_PROXY_PORT:-5433}"

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
  local deadline=$((SECONDS + SHUTDOWN_GRACE_SECONDS))
  while (( SECONDS < deadline )); do
    local proxy_alive=0
    local backend_alive=0
    local web_alive=0
    if [[ -n "${PROXY_PID:-}" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
      proxy_alive=1
    fi
    if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
      backend_alive=1
    fi
    if [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
      web_alive=1
    fi
    if [[ "$proxy_alive" == "0" && "$backend_alive" == "0" && "$web_alive" == "0" ]]; then
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

(
  cd "$WEB_DIR"
  exec npm run dev
) &
WEB_PID=$!

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
