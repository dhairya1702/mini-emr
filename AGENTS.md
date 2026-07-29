# Agent Operating Manual

This repo already has established scripts and runbooks. Agents should follow them instead of rediscovering infrastructure or inventing new deployment paths.

## Golden Rules

- Prefer repo scripts over ad hoc commands.
- Before cloud changes, verify the active `gcloud` config, account, project, region, and impersonation.
- Do not create new GCP projects, Firebase projects, Cloud Run services, SQL instances, buckets, schedulers, or secrets unless explicitly asked.
- Do not print secret values. Secret names are okay; raw secret values are not.
- Do not rotate, overwrite, or delete production secrets unless explicitly asked.
- If a deploy script fails, diagnose the script failure first. Do not replace it with a manual deploy path without user approval.
- Keep unrelated working tree changes intact.

## Local Development

Normal local launch:

```bash
./dev.sh
```

`dev.sh` starts:

- FastAPI backend on `127.0.0.1:8001`
- frontend dev server from `web/`
- ngrok tunnel for WhatsApp webhook testing

To run without ngrok:

```bash
NGROK_ENABLED=0 ./dev.sh
```

## WhatsApp Webhook Proxy

Fixed ngrok domain:

```text
https://terrell-unrightful-belinda.ngrok-free.dev
```

Meta WhatsApp webhook callback URL:

```text
https://terrell-unrightful-belinda.ngrok-free.dev/webhooks/whatsapp
```

Current dev defaults in `dev.sh`:

```text
NGROK_ENABLED=1
NGROK_URL=https://terrell-unrightful-belinda.ngrok-free.dev
WHATSAPP_SKIP_SIGNATURE_CHECK=1
BACKEND_PORT=8001
```

WhatsApp runbook:

```text
WHATSAPP_PHASE1_RUNBOOK.md
```

## Cloud Deployment Agent

Use the existing deploy scripts:

```bash
./scripts/deploy-all.sh
./scripts/deploy-backend.sh
./scripts/deploy-web.sh
```

Normal full production deploy:

```bash
gcloud config configurations activate clinic-emr
./scripts/deploy-all.sh
```

Human-run full production deploy (direct account authentication, promotes both services):

```bash
./scripts/deploy-all-human.sh
```

This command runs as `dhairya911@gmail.com` without impersonation for that process only.
It does not change the saved impersonation setting in the `clinic-emr` gcloud configuration.

Backend-only deploy:

```bash
gcloud config configurations activate clinic-emr
./scripts/deploy-backend.sh
```

Web-only deploy:

```bash
gcloud config configurations activate clinic-emr
./scripts/deploy-web.sh
```

Required GCP target:

```text
config: clinic-emr
account: dhairya911@gmail.com
project: project-e8d0eb79-8682-4bd9-b31
region: asia-south1
impersonation: clinic-emr-deploy-agent@project-e8d0eb79-8682-4bd9-b31.iam.gserviceaccount.com
```

Before deploy, run:

```bash
gcloud config configurations list
gcloud config get-value account
gcloud config get-value project
gcloud config get-value run/region
gcloud config get-value auth/impersonate_service_account
```

The deploy scripts source `scripts/deploy-common.sh`, which enforces the expected account/project/region and reads `.env.deploy` for deploy configuration.

Detailed cloud runbook:

```text
GCP_GCLOUD_CONFIGS.md
GCP_DEPLOYMENT.md
```

## Production Services

Known production values:

```text
Artifact Registry repo: clinic-emr
Backend Cloud Run service: clinic-emr-backend
Web Cloud Run service: clinic-os-ai
Cloud SQL instance: clinic-emr-prod
Cloud SQL connection: project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod
GCS bucket: clinic-emr-patient-attachments-prod
Backend public URL: https://clinic-emr-backend-388811826415.asia-south1.run.app
Web public URL: https://clinic-os-ai-388811826415.asia-south1.run.app
```

After deploy, verify:

```bash
curl -sS https://clinic-emr-backend-388811826415.asia-south1.run.app/health
curl -I -sS https://clinic-os-ai-388811826415.asia-south1.run.app
gcloud run services list --region=asia-south1
```

## Cloud SQL Proxy

Local Cloud SQL proxy port used during backend DB testing:

```text
127.0.0.1:5433
```

Cloud SQL connection name:

```text
project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod
```

Manual proxy command:

```bash
cloud-sql-proxy --port 5433 project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod
```

Prefer `./dev.sh` for normal local development. Use the manual Cloud SQL proxy only when debugging DB access directly or applying migrations against Cloud SQL.

## Database Migrations

Migration files live in:

```text
db/migrations/
```

Schema reference:

```text
db/schema.sql
```

Before applying a migration to Cloud SQL:

```bash
gcloud config configurations activate clinic-emr
gcloud config get-value project
lsof -nP -iTCP:5433 -sTCP:LISTEN
```

If the proxy is not already running, start:

```bash
cloud-sql-proxy --port 5433 project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod
```

Then apply the intended migration only. Do not run broad destructive SQL. Do not reset production data.

## Testing

Use focused tests for touched areas first.

Backend WhatsApp tests:

```bash
python3 -m pytest tests/test_whatsapp.py
```

Broader backend regression used during WhatsApp work:

```bash
python3 -m pytest tests/test_whatsapp.py tests/test_appointments.py tests/test_billing.py tests/test_postgres.py
```

Frontend/build checks live under `web/`; use the package scripts already defined there.

## Ask First

Ask before doing any of these:

- changing GCP project/account/region
- disabling or changing service-account impersonation except for the documented deploy workaround
- creating or deleting cloud infrastructure
- editing production secrets
- running Cloud Scheduler jobs manually
- running destructive SQL, data resets, or broad backfills
- replacing deploy scripts with manual `gcloud run deploy` commands

## Known Deploy Footgun

`APP_ORIGINS` can contain commas. The deploy scripts intentionally use custom delimiter syntax for `gcloud --set-env-vars` and `--update-env-vars`. Do not simplify that syntax unless you are specifically fixing deploy scripts and have tested the change.
