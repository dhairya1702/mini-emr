#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/deploy-common.sh"

deploy_root_dir
ensure_expected_gcloud_target
ensure_clean_release_tree
require_env_vars DATABASE_URL_SECRET_NAME AUTH_SECRET_NAME SUPER_ADMIN_IDENTIFIERS
require_scheduler_secret_for_reminders

IMAGE_TAG="$(resolve_image_tag)"
WEB_ORIGINS="$(resolve_web_origin_list)"
SECRET_BINDINGS="DATABASE_URL=${DATABASE_URL_SECRET_NAME}:latest,AUTH_SECRET=${AUTH_SECRET_NAME}:latest"
if [[ -n "${INTERNAL_SCHEDULER_SECRET_NAME:-}" ]]; then
  SECRET_BINDINGS+=",INTERNAL_SCHEDULER_TOKEN=${INTERNAL_SCHEDULER_SECRET_NAME}:latest"
fi
if [[ "$WHATSAPP_ENABLED" == "true" ]]; then
  require_env_vars \
    WHATSAPP_VERIFY_TOKEN_SECRET_NAME \
    WHATSAPP_APP_SECRET_NAME \
    WHATSAPP_ACCESS_TOKEN_SECRET_NAME \
    WHATSAPP_PHONE_NUMBER_ID_SECRET_NAME
  SECRET_BINDINGS+=",WHATSAPP_VERIFY_TOKEN=${WHATSAPP_VERIFY_TOKEN_SECRET_NAME}:latest"
  SECRET_BINDINGS+=",WHATSAPP_APP_SECRET=${WHATSAPP_APP_SECRET_NAME}:latest"
  SECRET_BINDINGS+=",WHATSAPP_ACCESS_TOKEN=${WHATSAPP_ACCESS_TOKEN_SECRET_NAME}:latest"
  SECRET_BINDINGS+=",WHATSAPP_PHONE_NUMBER_ID=${WHATSAPP_PHONE_NUMBER_ID_SECRET_NAME}:latest"
fi

echo "Building backend image with tag: $IMAGE_TAG"
gcloud builds submit \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --config=cloudbuild.backend.yaml \
  --substitutions="_AR_REPO=${AR_REPO},SHORT_SHA=${IMAGE_TAG}"

MIGRATION_JOB="${BACKEND_SERVICE}-migrate"
echo "Preparing database migration job: $MIGRATION_JOB"
gcloud run jobs deploy "$MIGRATION_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clinic-emr-backend:${IMAGE_TAG}" \
  --service-account="$BACKEND_SA" \
  --set-cloudsql-instances="$SQL_CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=${DATABASE_URL_SECRET_NAME}:latest" \
  --command=python \
  --args=-m,app.migrations,apply \
  --max-retries=0 \
  --task-timeout=10m

echo "Running required database migrations"
gcloud run jobs execute "$MIGRATION_JOB" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --wait

echo "Deploying backend service: $BACKEND_SERVICE"
gcloud run deploy "$BACKEND_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clinic-emr-backend:${IMAGE_TAG}" \
  --service-account="$BACKEND_SA" \
  --allow-unauthenticated \
  --add-cloudsql-instances="$SQL_CONNECTION_NAME" \
  --set-secrets="$SECRET_BINDINGS" \
  --set-env-vars="GCS_PATIENT_ATTACHMENTS_BUCKET=${GCS_BUCKET}" \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --set-env-vars="GOOGLE_CLOUD_LOCATION=global" \
  --set-env-vars="GEMINI_MODEL=gemini-3.5-flash" \
  --set-env-vars="APP_ORIGIN=${WEB_URL}" \
  --set-env-vars="^@^APP_ORIGINS=${WEB_ORIGINS}" \
  --set-env-vars="^|^SUPER_ADMIN_IDENTIFIERS=${SUPER_ADMIN_IDENTIFIERS}" \
  --set-env-vars="OPEN_CLINIC_REGISTRATION=true" \
  --set-env-vars="FOLLOW_UP_REMINDER_RUNNER_ENABLED=${FOLLOW_UP_REMINDER_RUNNER_ENABLED}" \
  --set-env-vars="FOLLOW_UP_REMINDER_INTERVAL_SECONDS=${FOLLOW_UP_REMINDER_INTERVAL_SECONDS}" \
  --set-env-vars="WHATSAPP_ENABLED=${WHATSAPP_ENABLED}" \
  --set-env-vars="WHATSAPP_GRAPH_API_VERSION=${WHATSAPP_GRAPH_API_VERSION}" \
  --set-env-vars="WHATSAPP_DOCUMENT_TEMPLATE_NAME=${WHATSAPP_DOCUMENT_TEMPLATE_NAME}" \
  --set-env-vars="WHATSAPP_DOCUMENT_TEMPLATE_LANGUAGE=${WHATSAPP_DOCUMENT_TEMPLATE_LANGUAGE}" \
  --set-env-vars="WHATSAPP_FOLLOW_UP_TEMPLATE_NAME=${WHATSAPP_FOLLOW_UP_TEMPLATE_NAME}" \
  --set-env-vars="WHATSAPP_FOLLOW_UP_TEMPLATE_LANGUAGE=${WHATSAPP_FOLLOW_UP_TEMPLATE_LANGUAGE}" \
  --set-env-vars="DB_POOL_MIN_SIZE=1" \
  --set-env-vars="DB_POOL_MAX_SIZE=10" \
  --set-env-vars="DB_POOL_TIMEOUT_SECONDS=10" \
  --timeout=30m \
  --concurrency=80 \
  --max-instances=3 \
  --no-traffic

LATEST_REVISION="$(gcloud run services describe "$BACKEND_SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.latestCreatedRevisionName)')"
promote_revision_if_requested "$BACKEND_SERVICE" "$LATEST_REVISION" "backend"
