#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
WEB_DIR="$ROOT_DIR/web"
BACKEND_VENV="$BACKEND_DIR/.venv"

if [[ ! -d "$BACKEND_VENV" ]]; then
  python3 -m venv "$BACKEND_VENV"
fi

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

(
  cd "$BACKEND_DIR"
  source "$BACKEND_VENV/bin/activate"
  exec uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
) &
BACKEND_PID=$!

(
  cd "$WEB_DIR"
  exec npm run dev
) &
WEB_PID=$!

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
