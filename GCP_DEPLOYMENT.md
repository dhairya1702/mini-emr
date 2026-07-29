# GCP Deployment

This repo can be deployed to GCP with:

- Project ID: `project-e8d0eb79-8682-4bd9-b31`
- Region: `asia-south1`
- Runtime:
  - `web` on Cloud Run
  - `backend` on Cloud Run
- Database target: Cloud SQL for PostgreSQL
- Attachment storage: Google Cloud Storage
- Reminder runner: Cloud Scheduler invoking the backend
- URL strategy: temporary `run.app` URLs
- Secret handling for now: plain environment variables

## Chosen Defaults

- Artifact Registry repo: `clinic-emr`
- Backend Cloud Run service: `clinic-emr-backend`
- Web Cloud Run service: `clinic-os-ai`
- GCS bucket: `clinic-emr-patient-attachments-prod`
- Reminder endpoint path: `/internal/run-follow-up-reminders`

## Current Gap

The repo now has container and Cloud Build scaffolding. The backend also exposes a scheduler-safe internal reminder endpoint, but it still needs real deployment validation against Cloud SQL and GCS.

## Required GCP Services

Enable at least:

- Cloud Run
- Cloud Build
- Artifact Registry
- Vertex AI API
- Cloud SQL Admin API
- Cloud Scheduler
- IAM
- Cloud Storage

## Required Runtime Environment

### Backend

- `DATABASE_URL=postgresql://USER:PASSWORD@/DB_NAME?host=/cloudsql/PROJECT:REGION:INSTANCE`
- `GCS_PATIENT_ATTACHMENTS_BUCKET=clinic-emr-patient-attachments-prod`
- `AUTH_SECRET=...`
- `GOOGLE_CLOUD_PROJECT=project-e8d0eb79-8682-4bd9-b31`
- `GOOGLE_CLOUD_LOCATION=global`
- `GEMINI_MODEL=gemini-3.5-flash`
- `OPEN_CLINIC_REGISTRATION=true` for public clinic signup (`false` restores CID-gated signup)
- `INTERNAL_SCHEDULER_TOKEN=...`
- `APP_ORIGIN=https://WEB_RUN_URL`
- `APP_ORIGINS=https://WEB_RUN_URL`
- `SUPER_ADMIN_IDENTIFIERS=...`
- `FOLLOW_UP_REMINDER_RUNNER_ENABLED=false`
- `FOLLOW_UP_REMINDER_INTERVAL_SECONDS=300`

### Web

- `NEXT_PUBLIC_API_BASE_URL=https://BACKEND_RUN_URL`

## Deploy Script Workflow

The repo now includes manual deploy helpers:

- `./scripts/deploy-all-human.sh`
- `./scripts/deploy-backend.sh`
- `./scripts/deploy-web.sh`
- `./scripts/deploy-all.sh`

They all source `scripts/deploy-common.sh`, which:

- verifies `gcloud` is using:
  - account `dhairya911@gmail.com`
  - project `project-e8d0eb79-8682-4bd9-b31`
- loads local secrets from `.env.deploy` if present
- keeps the stable regional Cloud Run URL as the primary frontend origin

First-time local setup:

```bash
cp .env.deploy.example .env.deploy
```

Then edit `.env.deploy` with Secret Manager resource names and the non-secret
superadmin allowlist:

- `DATABASE_URL_SECRET_NAME`
- `AUTH_SECRET_NAME`
- `SUPER_ADMIN_IDENTIFIERS`

The secret values themselves must remain in Google Secret Manager. The Cloud Run
runtime service account needs `roles/secretmanager.secretAccessor`.

### Human Full Production Deployment

For the normal human-run deployment of both the backend and frontend, run this from
the repository root:

```bash
./scripts/deploy-all-human.sh
```

The script authenticates directly as `dhairya911@gmail.com` for its process. It does
not impersonate the deployment agent and does not change the impersonation setting
saved in the `clinic-emr` gcloud configuration.

The script performs the complete production workflow:

1. Validates the active account, project, region, service names, database target,
   storage bucket, and production URLs.
2. Refuses to deploy from a dirty or untracked Git working tree.
3. Builds and pushes the backend image using the current Git commit as its tag.
4. Deploys and executes the required Cloud Run database migration job.
5. Deploys the backend revision and promotes it to 100% production traffic.
6. Resolves the deployed backend URL.
7. Builds the frontend with its `/api` proxy targeting that backend.
8. Deploys the frontend revision and promotes it to 100% production traffic.
9. Verifies the backend health endpoint and confirms the frontend responds.

The production URLs are:

- Backend: `https://clinic-emr-backend-388811826415.asia-south1.run.app`
- Frontend: `https://clinic-os-ai-388811826415.asia-south1.run.app`

The script exits immediately if validation, build, migration, deployment, promotion,
or URL verification fails. Google may occasionally require the human account to log
in again when its credentials expire; that is separate from service-account
impersonation.

## Cloud Run URL Note

Cloud Run exposes two hostnames for the same service:

- the stable regional URL shown in deploy output, e.g. `https://clinic-os-ai-388811826415.asia-south1.run.app`
- the canonical URL returned by `gcloud run services describe --format='value(status.url)'`

They both point to the same service. For this project:

- use the regional `asia-south1.run.app` URL as the primary public frontend URL
- allow the canonical `a.run.app` hostname only as a secondary CORS origin

This avoids backend CORS mismatches when the browser is opened on the regional URL.

## Cloud SQL Notes

This repo's Postgres code expects a normal PostgreSQL connection string in `DATABASE_URL`.

For Cloud Run with Cloud SQL Unix socket mounting, use the pattern:

```text
postgresql://DB_USER:DB_PASSWORD@/DB_NAME?host=/cloudsql/PROJECT:REGION:INSTANCE
```

When deploying the backend Cloud Run service, attach the Cloud SQL instance with `--add-cloudsql-instances`.

## GCS Notes

Attachment bytes are stored in Google Cloud Storage by [backend/app/storage.py](/Users/dhairyalalwani/PycharmProjects/mr/backend/app/storage.py).

Create the chosen bucket:

```bash
gcloud storage buckets create gs://clinic-emr-patient-attachments-prod \
  --project=project-e8d0eb79-8682-4bd9-b31 \
  --location=asia-south1 \
  --uniform-bucket-level-access
```

The Cloud Run backend service account needs read/write access to that bucket.

## Build Images

Create the Artifact Registry repository once:

```bash
gcloud artifacts repositories create clinic-emr \
  --project=project-e8d0eb79-8682-4bd9-b31 \
  --repository-format=docker \
  --location=asia-south1
```

Build backend:

```bash
gcloud builds submit \
  --project=project-e8d0eb79-8682-4bd9-b31 \
  --region=asia-south1 \
  --config=cloudbuild.backend.yaml
```

Build web after you know the backend `run.app` URL:

```bash
gcloud builds submit \
  --project=project-e8d0eb79-8682-4bd9-b31 \
  --region=asia-south1 \
  --config=cloudbuild.web.yaml \
  --substitutions=_API_BASE_URL=https://BACKEND_RUN_URL
```

## Deploy Backend

Before deploying:

1. Create the Cloud SQL Postgres instance.
2. Apply [db/schema.sql](/Users/dhairyalalwani/PycharmProjects/mr/db/schema.sql).
3. Create a database and user.
4. Prepare the Cloud SQL socket-style `DATABASE_URL`.

Deploy:

```bash
gcloud run deploy clinic-emr-backend \
  --project=project-e8d0eb79-8682-4bd9-b31 \
  --region=asia-south1 \
  --image=asia-south1-docker.pkg.dev/project-e8d0eb79-8682-4bd9-b31/clinic-emr/clinic-emr-backend:SHORT_SHA \
  --platform=managed \
  --allow-unauthenticated \
  --add-cloudsql-instances=PROJECT:REGION:INSTANCE \
  --set-secrets=DATABASE_URL=clinic-emr-database-url:latest,AUTH_SECRET=clinic-emr-auth-secret:latest \
  --set-env-vars=GCS_PATIENT_ATTACHMENTS_BUCKET=clinic-emr-patient-attachments-prod,FOLLOW_UP_REMINDER_RUNNER_ENABLED=false,FOLLOW_UP_REMINDER_INTERVAL_SECONDS=300,APP_ORIGIN=https://WEB_RUN_URL,APP_ORIGINS=https://WEB_RUN_URL,GOOGLE_CLOUD_PROJECT=project-e8d0eb79-8682-4bd9-b31,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=gemini-3.5-flash,OPEN_CLINIC_REGISTRATION=true,SUPER_ADMIN_IDENTIFIERS=REPLACE_ME
```

## Deploy Web

After the backend exists and you have its `run.app` URL, rebuild the web image with `_API_BASE_URL=https://BACKEND_RUN_URL`.

Deploy:

```bash
gcloud run deploy clinic-os-ai \
  --project=project-e8d0eb79-8682-4bd9-b31 \
  --region=asia-south1 \
  --image=asia-south1-docker.pkg.dev/project-e8d0eb79-8682-4bd9-b31/clinic-emr/clinic-emr-web:SHORT_SHA \
  --platform=managed \
  --allow-unauthenticated
```

Then update the backend `APP_ORIGIN` and `APP_ORIGINS` to the real web `run.app` URL if they were deployed with placeholders.

## Scheduler Plan

Current desired mode is Cloud Scheduler.

### What still needs code support

The backend now exposes `POST /internal/run-follow-up-reminders`.

It currently expects:

- header: `X-Internal-Token`
- env var: `INTERNAL_SCHEDULER_TOKEN`

Later, this can be hardened further with OIDC if desired.

### Suggested Scheduler command after that route exists

```bash
gcloud scheduler jobs create http clinic-emr-follow-up-reminders \
  --project=project-e8d0eb79-8682-4bd9-b31 \
  --location=asia-south1 \
  --schedule="*/5 * * * *" \
  --uri="https://BACKEND_RUN_URL/internal/run-follow-up-reminders" \
  --http-method=POST \
  --headers="X-Internal-Token=REPLACE_ME"
```

## Production Validation Checklist

Run these checks against the Cloud Run deployment:

1. `GET /health`
2. register a clinic
3. log in
4. create a patient
5. create and check in an appointment
6. generate and finalize a note
7. create and send an invoice
8. upload and download an attachment
9. create a follow-up
10. open `/superuser` if enabled

## Recommended Next Steps

1. Stand up Cloud SQL and run the backend against [db/schema.sql](/Users/dhairyalalwani/PycharmProjects/mr/db/schema.sql).
2. Validate GCS attachment upload/download.
3. Validate that the deployed revision resolves every configured Secret Manager binding.
