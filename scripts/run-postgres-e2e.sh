#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER_NAME="${E2E_POSTGRES_CONTAINER:-clinic-emr-e2e-postgres}"
POSTGRES_IMAGE="${E2E_POSTGRES_IMAGE:-postgres:16-alpine}"
POSTGRES_PORT="${E2E_POSTGRES_PORT:-55432}"
POSTGRES_USER="${E2E_POSTGRES_USER:-clinic_e2e}"
POSTGRES_PASSWORD="${E2E_POSTGRES_PASSWORD:-clinic_e2e_password}"
POSTGRES_DB="${E2E_POSTGRES_DB:-clinic_e2e_test}"
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to run the Postgres E2E suite." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker, then rerun this command." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to wait for the E2E Postgres database." >&2
  exit 1
fi

cleanup() {
  docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
docker run \
  --rm \
  --detach \
  --name "${CONTAINER_NAME}" \
  --publish "127.0.0.1:${POSTGRES_PORT}:5432" \
  --env "POSTGRES_USER=${POSTGRES_USER}" \
  --env "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
  --env "POSTGRES_DB=${POSTGRES_DB}" \
  "${POSTGRES_IMAGE}" >/dev/null

for attempt in {1..60}; do
  if psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -Atc "select 1" >/dev/null 2>&1; then
    break
  fi
  if [[ "${attempt}" == "60" ]]; then
    echo "Timed out waiting for E2E Postgres to accept connections." >&2
    exit 1
  fi
  sleep 1
done

cd "${ROOT_DIR}/web"
E2E_POSTGRES_DATABASE_URL="${DATABASE_URL}" \
E2E_ALLOW_DATABASE_RESET=true \
npm run test:e2e:postgres
