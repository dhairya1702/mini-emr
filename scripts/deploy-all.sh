#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/deploy-common.sh"

deploy_root_dir
ensure_expected_gcloud_target
ensure_clean_release_tree
require_env_vars DATABASE_URL_SECRET_NAME AUTH_SECRET_NAME SUPER_ADMIN_IDENTIFIERS

export IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"

echo "Using shared image tag: $IMAGE_TAG"

bash scripts/deploy-backend.sh
export BACKEND_URL="${BACKEND_URL:-$(resolve_backend_url)}"
bash scripts/deploy-web.sh

echo "Release candidates prepared. No production traffic was changed."
echo "Follow PRODUCTION_RELEASE_RUNBOOK.md for validation and explicit traffic promotion."
