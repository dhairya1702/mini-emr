#!/usr/bin/env bash

set -euo pipefail

EXPECTED_CONFIG_NAME="clinic-emr"
EXPECTED_ACCOUNT="dhairya911@gmail.com"
EXPECTED_PROJECT_ID="project-e8d0eb79-8682-4bd9-b31"
EXPECTED_REGION="asia-south1"
EXPECTED_AR_REPO="clinic-emr"
EXPECTED_BACKEND_SERVICE="clinic-emr-backend"
EXPECTED_WEB_SERVICE="clinic-os-ai"
EXPECTED_SQL_CONNECTION_NAME="project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod"
EXPECTED_DB_NAME="clinic_emr"
EXPECTED_DB_USER="clinic_app"
EXPECTED_GCS_BUCKET="clinic-emr-patient-attachments-prod"
EXPECTED_BACKEND_SA="clinic-emr-backend@${EXPECTED_PROJECT_ID}.iam.gserviceaccount.com"
EXPECTED_BACKEND_URL="https://clinic-emr-backend-388811826415.asia-south1.run.app"
EXPECTED_WEB_URL="https://clinic-os-ai-388811826415.asia-south1.run.app"
EXPECTED_IMPERSONATION="clinic-emr-deploy-agent@${EXPECTED_PROJECT_ID}.iam.gserviceaccount.com"

# These literal placeholder strings are only used for validation messages.
DEFAULT_SUPER_ADMIN_IDENTIFIERS="dhairya911@gmail.com"
DEFAULT_DATABASE_URL_SECRET_NAME="clinic-emr-database-url"
DEFAULT_AUTH_SECRET_NAME="clinic-emr-auth-secret"
DEFAULT_INTERNAL_SCHEDULER_SECRET_NAME=""
DEFAULT_PRODUCTION_REMINDERS_ENABLED="0"
DEFAULT_FOLLOW_UP_REMINDER_RUNNER_ENABLED="false"
DEFAULT_FOLLOW_UP_REMINDER_INTERVAL_SECONDS="300"
DEFAULT_WHATSAPP_ENABLED="false"

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
export SUPER_ADMIN_IDENTIFIERS="${SUPER_ADMIN_IDENTIFIERS:-$DEFAULT_SUPER_ADMIN_IDENTIFIERS}"
export DATABASE_URL_SECRET_NAME="${DATABASE_URL_SECRET_NAME:-$DEFAULT_DATABASE_URL_SECRET_NAME}"
export AUTH_SECRET_NAME="${AUTH_SECRET_NAME:-$DEFAULT_AUTH_SECRET_NAME}"
export INTERNAL_SCHEDULER_SECRET_NAME="${INTERNAL_SCHEDULER_SECRET_NAME:-$DEFAULT_INTERNAL_SCHEDULER_SECRET_NAME}"
export PRODUCTION_REMINDERS_ENABLED="${PRODUCTION_REMINDERS_ENABLED:-$DEFAULT_PRODUCTION_REMINDERS_ENABLED}"
export FOLLOW_UP_REMINDER_RUNNER_ENABLED="${FOLLOW_UP_REMINDER_RUNNER_ENABLED:-$DEFAULT_FOLLOW_UP_REMINDER_RUNNER_ENABLED}"
export FOLLOW_UP_REMINDER_INTERVAL_SECONDS="${FOLLOW_UP_REMINDER_INTERVAL_SECONDS:-$DEFAULT_FOLLOW_UP_REMINDER_INTERVAL_SECONDS}"
export WHATSAPP_ENABLED="${WHATSAPP_ENABLED:-$DEFAULT_WHATSAPP_ENABLED}"
export WHATSAPP_VERIFY_TOKEN_SECRET_NAME="${WHATSAPP_VERIFY_TOKEN_SECRET_NAME:-}"
export WHATSAPP_APP_SECRET_NAME="${WHATSAPP_APP_SECRET_NAME:-}"
export WHATSAPP_ACCESS_TOKEN_SECRET_NAME="${WHATSAPP_ACCESS_TOKEN_SECRET_NAME:-}"
export WHATSAPP_PHONE_NUMBER_ID_SECRET_NAME="${WHATSAPP_PHONE_NUMBER_ID_SECRET_NAME:-}"
export WHATSAPP_GRAPH_API_VERSION="${WHATSAPP_GRAPH_API_VERSION:-v23.0}"
export WHATSAPP_DOCUMENT_TEMPLATE_NAME="${WHATSAPP_DOCUMENT_TEMPLATE_NAME:-}"
export WHATSAPP_DOCUMENT_TEMPLATE_LANGUAGE="${WHATSAPP_DOCUMENT_TEMPLATE_LANGUAGE:-en}"
export WHATSAPP_FOLLOW_UP_TEMPLATE_NAME="${WHATSAPP_FOLLOW_UP_TEMPLATE_NAME:-}"
export WHATSAPP_FOLLOW_UP_TEMPLATE_LANGUAGE="${WHATSAPP_FOLLOW_UP_TEMPLATE_LANGUAGE:-en}"
export PROMOTE="${PROMOTE:-0}"
export BREAK_GLASS_DEPLOY_TARGET="${BREAK_GLASS_DEPLOY_TARGET:-0}"
export DEPLOY_AUTH_MODE="${DEPLOY_AUTH_MODE:-agent}"

validate_expected_value() {
  local name="$1"
  local actual="$2"
  local expected="$3"

  if [[ "$actual" != "$expected" ]]; then
    if [[ "$BREAK_GLASS_DEPLOY_TARGET" == "1" ]]; then
      echo "BREAK_GLASS_DEPLOY_TARGET=1: allowing $name='$actual' (expected '$expected')." >&2
      return
    fi
    echo "Refusing to deploy. $name is '$actual', expected '$expected'." >&2
    echo "Set BREAK_GLASS_DEPLOY_TARGET=1 only for an intentional target override." >&2
    exit 1
  fi
}

ensure_expected_deploy_variables() {
  validate_expected_value CLOUDSDK_ACTIVE_CONFIG_NAME "$CLOUDSDK_ACTIVE_CONFIG_NAME" "$EXPECTED_CONFIG_NAME"
  validate_expected_value PROJECT_ID "$PROJECT_ID" "$EXPECTED_PROJECT_ID"
  validate_expected_value REGION "$REGION" "$EXPECTED_REGION"
  validate_expected_value AR_REPO "$AR_REPO" "$EXPECTED_AR_REPO"
  validate_expected_value BACKEND_SERVICE "$BACKEND_SERVICE" "$EXPECTED_BACKEND_SERVICE"
  validate_expected_value WEB_SERVICE "$WEB_SERVICE" "$EXPECTED_WEB_SERVICE"
  validate_expected_value SQL_CONNECTION_NAME "$SQL_CONNECTION_NAME" "$EXPECTED_SQL_CONNECTION_NAME"
  validate_expected_value DB_NAME "$DB_NAME" "$EXPECTED_DB_NAME"
  validate_expected_value DB_USER "$DB_USER" "$EXPECTED_DB_USER"
  validate_expected_value GCS_BUCKET "$GCS_BUCKET" "$EXPECTED_GCS_BUCKET"
  validate_expected_value BACKEND_SA "$BACKEND_SA" "$EXPECTED_BACKEND_SA"
  validate_expected_value BACKEND_PUBLIC_URL "$BACKEND_PUBLIC_URL" "$EXPECTED_BACKEND_URL"
  validate_expected_value WEB_URL "$WEB_URL" "$EXPECTED_WEB_URL"
}

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

  ensure_expected_deploy_variables

  local active_config active_account active_project active_region active_impersonation expected_impersonation
  case "$DEPLOY_AUTH_MODE" in
    agent)
      expected_impersonation="$EXPECTED_IMPERSONATION"
      ;;
    human)
      expected_impersonation=""
      ;;
    *)
      echo "Refusing to deploy. DEPLOY_AUTH_MODE must be 'agent' or 'human', got '$DEPLOY_AUTH_MODE'." >&2
      exit 1
      ;;
  esac

  active_config="$(gcloud config configurations list --filter='is_active=true' --format='value(name)' 2>/dev/null | tr -d '\r')"
  active_account="$(gcloud config get-value account 2>/dev/null | tr -d '\r')"
  active_project="$(gcloud config get-value project 2>/dev/null | tr -d '\r')"
  active_region="$(gcloud config get-value run/region 2>/dev/null | tr -d '\r')"
  active_impersonation="$(gcloud config get-value auth/impersonate_service_account 2>/dev/null | tr -d '\r')"

  validate_expected_value "active gcloud config" "$active_config" "$EXPECTED_CONFIG_NAME"
  validate_expected_value "active gcloud account" "$active_account" "$EXPECTED_ACCOUNT"
  validate_expected_value "active gcloud project" "$active_project" "$EXPECTED_PROJECT_ID"
  validate_expected_value "active gcloud run/region" "$active_region" "$EXPECTED_REGION"
  validate_expected_value "active gcloud auth/impersonate_service_account" "$active_impersonation" "$expected_impersonation"
}

ensure_clean_release_tree() {
  require_command git
  if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
    echo "Refusing to release from a dirty or untracked working tree." >&2
    git status --short >&2
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

require_scheduler_secret_for_reminders() {
  if [[ "$PRODUCTION_REMINDERS_ENABLED" == "1" || "$FOLLOW_UP_REMINDER_RUNNER_ENABLED" == "true" ]]; then
    require_env_vars INTERNAL_SCHEDULER_SECRET_NAME
  fi
}

promote_revision_if_requested() {
  local service_name="$1"
  local revision_name="$2"
  local label="$3"

  if [[ "$PROMOTE" != "1" ]]; then
    echo "Prepared $label revision with zero traffic: $revision_name"
    echo "Set PROMOTE=1 to promote this revision to 100% production traffic."
    return
  fi

  echo "Promoting $label revision to 100% production traffic"
  gcloud run services update-traffic "$service_name" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --to-revisions="${revision_name}=100"

  echo "$label production traffic now points to: $revision_name"
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
