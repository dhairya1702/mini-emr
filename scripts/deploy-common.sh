#!/usr/bin/env bash

set -euo pipefail

EXPECTED_CONFIG_NAME="clinic-emr"
EXPECTED_ACCOUNT="dhairya911@gmail.com"
EXPECTED_PROJECT_ID="project-e8d0eb79-8682-4bd9-b31"
EXPECTED_REGION="asia-south1"
EXPECTED_AR_REPO="clinic-emr"
EXPECTED_BACKEND_SERVICE="clinic-emr-backend"
EXPECTED_WEB_SERVICE="clinic-emr-web"
EXPECTED_SQL_CONNECTION_NAME="project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod"
EXPECTED_DB_NAME="clinic_emr"
EXPECTED_DB_USER="clinic_app"
EXPECTED_GCS_BUCKET="clinic-emr-patient-attachments-prod"
EXPECTED_BACKEND_SA="clinic-emr-backend@${EXPECTED_PROJECT_ID}.iam.gserviceaccount.com"
EXPECTED_BACKEND_URL="https://clinic-emr-backend-388811826415.asia-south1.run.app"
EXPECTED_WEB_URL="https://clinic-emr-web-388811826415.asia-south1.run.app"

# These literal placeholder strings are only used for validation messages.
PLACEHOLDER_DB_PASSWORD="actual_database_password_here"
PLACEHOLDER_AUTH_SECRET="some_long_random_secret_here"
# Keep tracked defaults non-secret. Real values belong in .env.deploy, which is gitignored.
DEFAULT_DB_PASSWORD="$PLACEHOLDER_DB_PASSWORD"
DEFAULT_AUTH_SECRET="$PLACEHOLDER_AUTH_SECRET"
DEFAULT_SUPER_ADMIN_IDENTIFIERS="dhairya911@gmail.com"

# Load local deploy secrets before exporting defaults so shell vars still win when explicitly provided.
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/../.env.deploy" ]]; then
  # shellcheck disable=SC1091
  source "$(dirname "${BASH_SOURCE[0]}")/../.env.deploy"
fi

export CLOUDSDK_ACTIVE_CONFIG_NAME="${CLOUDSDK_ACTIVE_CONFIG_NAME:-$EXPECTED_CONFIG_NAME}"
export PROJECT_ID="${PROJECT_ID:-$EXPECTED_PROJECT_ID}"
export REGION="${REGION:-$EXPECTED_REGION}"
export AR_REPO="${AR_REPO:-$EXPECTED_AR_REPO}"
export BACKEND_SERVICE="${BACKEND_SERVICE:-$EXPECTED_BACKEND_SERVICE}"
export WEB_SERVICE="${WEB_SERVICE:-$EXPECTED_WEB_SERVICE}"
export SQL_CONNECTION_NAME="${SQL_CONNECTION_NAME:-$EXPECTED_SQL_CONNECTION_NAME}"
export DB_NAME="${DB_NAME:-$EXPECTED_DB_NAME}"
export DB_USER="${DB_USER:-$EXPECTED_DB_USER}"
export GCS_BUCKET="${GCS_BUCKET:-$EXPECTED_GCS_BUCKET}"
export BACKEND_SA="${BACKEND_SA:-$EXPECTED_BACKEND_SA}"
export BACKEND_PUBLIC_URL="${BACKEND_PUBLIC_URL:-$EXPECTED_BACKEND_URL}"
export WEB_URL="${WEB_URL:-$EXPECTED_WEB_URL}"
export DB_PASSWORD="${DB_PASSWORD:-$DEFAULT_DB_PASSWORD}"
export AUTH_SECRET="${AUTH_SECRET:-$DEFAULT_AUTH_SECRET}"
export SUPER_ADMIN_IDENTIFIERS="${SUPER_ADMIN_IDENTIFIERS:-$DEFAULT_SUPER_ADMIN_IDENTIFIERS}"

deploy_root_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

ensure_expected_gcloud_target() {
  require_command gcloud

  local active_account active_project
  active_account="$(gcloud config get-value account 2>/dev/null | tr -d '\r')"
  active_project="$(gcloud config get-value project 2>/dev/null | tr -d '\r')"

  if [[ "$active_account" != "$EXPECTED_ACCOUNT" ]]; then
    echo "Refusing to deploy. Active gcloud account is '$active_account', expected '$EXPECTED_ACCOUNT'." >&2
    exit 1
  fi

  if [[ "$active_project" != "$EXPECTED_PROJECT_ID" ]]; then
    echo "Refusing to deploy. Active gcloud project is '$active_project', expected '$EXPECTED_PROJECT_ID'." >&2
    exit 1
  fi
}

require_env_vars() {
  local missing=()
  local name
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      missing+=("$name")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    echo "Missing required environment variables: ${missing[*]}" >&2
    exit 1
  fi
}

require_non_placeholder_secrets() {
  local placeholders=()

  if [[ "${DB_PASSWORD:-}" == "$PLACEHOLDER_DB_PASSWORD" ]]; then
    placeholders+=("DB_PASSWORD")
  fi

  if [[ "${AUTH_SECRET:-}" == "$PLACEHOLDER_AUTH_SECRET" ]]; then
    placeholders+=("AUTH_SECRET")
  fi

  if (( ${#placeholders[@]} > 0 )); then
    echo "Refusing to deploy with placeholder values: ${placeholders[*]}" >&2
    echo "Edit scripts/deploy-common.sh once and replace the default placeholder values." >&2
    exit 1
  fi
}

resolve_image_tag() {
  if [[ -n "${IMAGE_TAG:-}" ]]; then
    echo "$IMAGE_TAG"
    return
  fi
  git rev-parse --short HEAD
}

resolve_backend_url() {
  gcloud run services describe "$BACKEND_SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.url)'
}

resolve_web_url() {
  gcloud run services describe "$WEB_SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --format='value(status.url)'
}

resolve_backend_origin_list() {
  local canonical_backend
  canonical_backend="$(resolve_backend_url)"
  if [[ -n "$canonical_backend" && "$canonical_backend" != "$BACKEND_PUBLIC_URL" ]]; then
    printf "%s,%s" "$BACKEND_PUBLIC_URL" "$canonical_backend"
    return
  fi
  printf "%s" "$BACKEND_PUBLIC_URL"
}

resolve_web_origin_list() {
  local canonical_web
  canonical_web="$(resolve_web_url)"
  # Cloud Run exposes both a stable regional run.app URL and a canonical a.run.app URL
  # for the same service. The frontend uses the regional URL as the primary public host,
  # so backend CORS must always include that origin first and optionally allow the
  # canonical hostname as a secondary origin.
  if [[ -n "$canonical_web" && "$canonical_web" != "$WEB_URL" ]]; then
    printf "%s,%s" "$WEB_URL" "$canonical_web"
    return
  fi
  printf "%s" "$WEB_URL"
}
