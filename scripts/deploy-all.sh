#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/deploy-common.sh"

deploy_root_dir
ensure_expected_gcloud_target
require_env_vars DB_PASSWORD AUTH_SECRET SUPER_ADMIN_IDENTIFIERS
require_non_placeholder_secrets

export IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)-$(date +%H%M)}"

echo "Using shared image tag: $IMAGE_TAG"

bash scripts/deploy-backend.sh
export BACKEND_URL="${BACKEND_URL:-$(resolve_backend_url)}"
bash scripts/deploy-web.sh

WEB_ORIGINS="$(resolve_web_origin_list)"
echo "Syncing backend APP_ORIGIN to stable public URL: $WEB_URL"
gcloud run services update "$BACKEND_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-env-vars="APP_ORIGIN=${WEB_URL},APP_ORIGINS=${WEB_ORIGINS}"

echo "Deployment complete."
echo "Backend: $BACKEND_PUBLIC_URL"
echo "Web: $WEB_URL"
