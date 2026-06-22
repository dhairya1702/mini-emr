#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/deploy-common.sh"

deploy_root_dir
ensure_expected_gcloud_target
require_env_vars DB_PASSWORD AUTH_SECRET SUPER_ADMIN_IDENTIFIERS
require_non_placeholder_secrets

IMAGE_TAG="$(resolve_image_tag)"
WEB_ORIGINS="$(resolve_web_origin_list)"

echo "Building backend image with tag: $IMAGE_TAG"
gcloud builds submit \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --config=cloudbuild.backend.yaml \
  --substitutions=SHORT_SHA="$IMAGE_TAG"

echo "Deploying backend service: $BACKEND_SERVICE"
gcloud run deploy "$BACKEND_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clinic-emr-backend:${IMAGE_TAG}" \
  --service-account="$BACKEND_SA" \
  --allow-unauthenticated \
  --add-cloudsql-instances="$SQL_CONNECTION_NAME" \
  --set-env-vars="DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${SQL_CONNECTION_NAME}" \
  --set-env-vars="GCS_PATIENT_ATTACHMENTS_BUCKET=${GCS_BUCKET}" \
  --set-env-vars="AUTH_SECRET=${AUTH_SECRET}" \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --set-env-vars="GOOGLE_CLOUD_LOCATION=global" \
  --set-env-vars="GEMINI_MODEL=gemini-2.5-flash" \
  --set-env-vars="APP_ORIGIN=${WEB_URL}" \
  --set-env-vars="^@^APP_ORIGINS=${WEB_ORIGINS}" \
  --set-env-vars="SUPER_ADMIN_IDENTIFIERS=${SUPER_ADMIN_IDENTIFIERS}" \
  --set-env-vars="FOLLOW_UP_REMINDER_RUNNER_ENABLED=false" \
  --set-env-vars="FOLLOW_UP_REMINDER_INTERVAL_SECONDS=300"

BACKEND_URL="$(resolve_backend_url)"
echo "Backend deployed: $BACKEND_URL"
curl -sS "${BACKEND_URL}/health"
echo
