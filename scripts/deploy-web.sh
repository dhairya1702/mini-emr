#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/deploy-common.sh"

deploy_root_dir
ensure_expected_gcloud_target

IMAGE_TAG="$(resolve_image_tag)"
BACKEND_URL="${BACKEND_URL:-$(resolve_backend_url)}"

if [[ -z "$BACKEND_URL" ]]; then
  echo "Could not resolve backend Cloud Run URL. Deploy backend first or set BACKEND_URL." >&2
  exit 1
fi

echo "Building web image with tag: $IMAGE_TAG"
echo "Using backend URL: $BACKEND_URL"
gcloud builds submit \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --config=cloudbuild.web.yaml \
  --substitutions="_API_BASE_URL=${BACKEND_URL},SHORT_SHA=${IMAGE_TAG}"

echo "Deploying web service: $WEB_SERVICE"
gcloud run deploy "$WEB_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/clinic-emr-web:${IMAGE_TAG}" \
  --allow-unauthenticated

CURRENT_WEB_URL="$(resolve_web_url)"
echo "Web deployed: $CURRENT_WEB_URL"
