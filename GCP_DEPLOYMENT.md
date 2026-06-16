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
- Supabase fallback: kept in code for now, but GCP is the intended deployment path

## Chosen Defaults

- Artifact Registry repo: `clinic-emr`
- Backend Cloud Run service: `clinic-emr-backend`
- Web Cloud Run service: `clinic-emr-web`
- GCS bucket: `clinic-emr-patient-attachments-prod`
- Reminder endpoint path: `/internal/run-follow-up-reminders`

## Current Gap

The repo now has container and Cloud Build scaffolding. The backend also exposes a scheduler-safe internal reminder endpoint, but it still needs real deployment validation against Cloud SQL and GCS.

## Required GCP Services

Enable at least:

- Cloud Run
- Cloud Build
- Artifact Registry
- Cloud SQL Admin API
- Cloud Scheduler
- IAM
- Cloud Storage

## Required Runtime Environment

### Backend

- `DATABASE_BACKEND=postgres`
- `DATABASE_URL=postgresql://USER:PASSWORD@/DB_NAME?host=/cloudsql/PROJECT:REGION:INSTANCE`
- `STORAGE_BACKEND=gcs`
- `GCS_PATIENT_ATTACHMENTS_BUCKET=clinic-emr-patient-attachments-prod`
- `AUTH_SECRET=...`
- `ANTHROPIC_API_KEY=...`
- `ANTHROPIC_MODEL=claude-sonnet-4-20250514`
- `INTERNAL_SCHEDULER_TOKEN=...`
- `APP_ORIGIN=https://WEB_RUN_URL`
- `APP_ORIGINS=https://WEB_RUN_URL`
- `SUPER_ADMIN_IDENTIFIERS=...`
- `FOLLOW_UP_REMINDER_RUNNER_ENABLED=false`
- `FOLLOW_UP_REMINDER_INTERVAL_SECONDS=300`

### Web

- `NEXT_PUBLIC_API_BASE_URL=https://BACKEND_RUN_URL`

## Cloud SQL Notes

This repo's Postgres code expects a normal PostgreSQL connection string in `DATABASE_URL`.

For Cloud Run with Cloud SQL Unix socket mounting, use the pattern:

```text
postgresql://DB_USER:DB_PASSWORD@/DB_NAME?host=/cloudsql/PROJECT:REGION:INSTANCE
```

When deploying the backend Cloud Run service, attach the Cloud SQL instance with `--add-cloudsql-instances`.

## GCS Notes

Attachment bytes are selected by `STORAGE_BACKEND=gcs` in [backend/app/storage.py](/Users/dhairyalalwani/PycharmProjects/mr/backend/app/storage.py).

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
  --set-env-vars=DATABASE_BACKEND=postgres,STORAGE_BACKEND=gcs,GCS_PATIENT_ATTACHMENTS_BUCKET=clinic-emr-patient-attachments-prod,FOLLOW_UP_REMINDER_RUNNER_ENABLED=false,FOLLOW_UP_REMINDER_INTERVAL_SECONDS=300,APP_ORIGIN=https://WEB_RUN_URL,APP_ORIGINS=https://WEB_RUN_URL,DATABASE_URL='postgresql://DB_USER:DB_PASSWORD@/DB_NAME?host=/cloudsql/PROJECT:REGION:INSTANCE',AUTH_SECRET=REPLACE_ME,ANTHROPIC_API_KEY=REPLACE_ME,ANTHROPIC_MODEL=claude-sonnet-4-20250514,SUPER_ADMIN_IDENTIFIERS=REPLACE_ME
```

## Deploy Web

After the backend exists and you have its `run.app` URL, rebuild the web image with `_API_BASE_URL=https://BACKEND_RUN_URL`.

Deploy:

```bash
gcloud run deploy clinic-emr-web \
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

## What Is Still Not Done

- real Cloud SQL validation is not yet documented as completed
- real GCS validation is not yet documented as completed
- data migration from Supabase DB and Supabase Storage is not yet implemented
- Secret Manager wiring is not yet in place

## Recommended Next Steps

1. Stand up Cloud SQL and run the backend against [db/schema.sql](/Users/dhairyalalwani/PycharmProjects/mr/db/schema.sql).
2. Validate GCS attachment upload/download.
3. Rehearse data migration off Supabase.
4. Move env secrets into Secret Manager when you are ready.
