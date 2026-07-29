#!/usr/bin/env bash

set -euo pipefail

# Run gcloud directly as the configured human account for this process only.
# The saved clinic-emr configuration keeps its deploy-agent impersonation setting.
export DEPLOY_AUTH_MODE="human"
export CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT=""
export PROMOTE="1"

echo "Deploying backend and frontend directly as dhairya911@gmail.com"
echo "Production backend: https://clinic-emr-backend-388811826415.asia-south1.run.app"
echo "Production frontend: https://clinic-os-ai-388811826415.asia-south1.run.app"

bash "$(dirname "$0")/deploy-all.sh"

echo "Verifying production URLs"
curl -fsS "https://clinic-emr-backend-388811826415.asia-south1.run.app/health"
curl -fsSI "https://clinic-os-ai-388811826415.asia-south1.run.app" >/dev/null

echo
echo "Deployment verified:"
echo "Backend: https://clinic-emr-backend-388811826415.asia-south1.run.app"
echo "Frontend: https://clinic-os-ai-388811826415.asia-south1.run.app"
