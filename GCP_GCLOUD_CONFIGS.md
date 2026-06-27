# GCloud Configs

Use named `gcloud` configurations so Clinic EMR service-account impersonation does not leak into other GCP projects.

## Current Clinic EMR Config

The Clinic EMR production config is:

```bash
gcloud config configurations activate clinic-emr
```

Expected values:

```text
account: dhairya911@gmail.com
project: project-e8d0eb79-8682-4bd9-b31
run/region: asia-south1
auth/impersonate_service_account: clinic-emr-deploy-agent@project-e8d0eb79-8682-4bd9-b31.iam.gserviceaccount.com
```

Verify it:

```bash
gcloud config configurations list
gcloud config get-value account
gcloud config get-value project
gcloud config get-value run/region
gcloud config get-value auth/impersonate_service_account
gcloud run services list
```

When this config is active, GCP commands run as the deploy agent:

```text
clinic-emr-deploy-agent@project-e8d0eb79-8682-4bd9-b31.iam.gserviceaccount.com
```

## Switch Away To Another Project

Create a separate config for another account/project:

```bash
gcloud config configurations create other-project
gcloud config configurations activate other-project
gcloud config unset auth/impersonate_service_account
gcloud config set account YOUR_OTHER_EMAIL
gcloud config set project YOUR_OTHER_PROJECT_ID
```

If the other account is not logged in yet:

```bash
gcloud auth login
```

Verify before running commands:

```bash
gcloud config configurations list
gcloud config list
gcloud config get-value auth/impersonate_service_account
```

For non-Clinic projects, `auth/impersonate_service_account` should usually be unset.

## Switch Back To Clinic EMR

```bash
gcloud config configurations activate clinic-emr
gcloud config get-value project
gcloud config get-value auth/impersonate_service_account
gcloud run services list
```

Expected project:

```text
project-e8d0eb79-8682-4bd9-b31
```

Expected impersonation:

```text
clinic-emr-deploy-agent@project-e8d0eb79-8682-4bd9-b31.iam.gserviceaccount.com
```

## Temporarily Disable Impersonation

Use this if you want commands to run directly as your Gmail in the active config:

```bash
gcloud config unset auth/impersonate_service_account
```

Turn Clinic EMR impersonation back on:

```bash
gcloud config set auth/impersonate_service_account \
  clinic-emr-deploy-agent@project-e8d0eb79-8682-4bd9-b31.iam.gserviceaccount.com
```

## Useful Clinic EMR Ops Commands

List services:

```bash
gcloud run services list --region=asia-south1
```

Read backend logs:

```bash
gcloud run services logs read clinic-emr-backend --region=asia-south1 --limit=100
```

Read web logs:

```bash
gcloud run services logs read clinic-emr-web --region=asia-south1 --limit=100
```

List Cloud SQL instances:

```bash
gcloud sql instances list
```

List scheduler jobs:

```bash
gcloud scheduler jobs list --location=asia-south1
```

## Deploy Scripts

The repo has three deploy helpers under `scripts/`.

`scripts/deploy-common.sh`

This is shared by all deploy scripts. It:

- Enforces the expected `gcloud` target before deployment.
- Expected config: `clinic-emr`.
- Expected account: `dhairya911@gmail.com`.
- Expected project: `project-e8d0eb79-8682-4bd9-b31`.
- Expected region: `asia-south1`.
- Loads deploy configuration from `.env.deploy` if present.
- Exports stable service names, Artifact Registry repo, Cloud SQL connection name, GCS bucket, backend service account, and public Cloud Run URLs.
- Refuses to deploy unless the required Secret Manager names and superadmin allowlist are configured.

`scripts/deploy-backend.sh`

This builds and deploys only the backend. It:

- Builds `backend/Dockerfile` with Cloud Build.
- Pushes the image to Artifact Registry:
  `asia-south1-docker.pkg.dev/project-e8d0eb79-8682-4bd9-b31/clinic-emr/clinic-emr-backend:<IMAGE_TAG>`
- Deploys Cloud Run service `clinic-emr-backend`.
- Attaches Cloud SQL instance `project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod`.
- Injects `DATABASE_URL`, `AUTH_SECRET`, and `SUPER_ADMIN_TOTP_SECRETS` from Secret Manager.
- Sets non-secret backend runtime env vars, including `APP_ORIGIN`, `APP_ORIGINS`, Vertex AI settings, GCS bucket, and follow-up reminder settings.
- Runs a backend `/health` check after deploy.

`scripts/deploy-web.sh`

This builds and deploys only the web app. It:

- Resolves the backend Cloud Run URL.
- Builds `web/Dockerfile` with Cloud Build.
- Passes `NEXT_PUBLIC_API_BASE_URL` as the backend URL at build time.
- Pushes the image to Artifact Registry:
  `asia-south1-docker.pkg.dev/project-e8d0eb79-8682-4bd9-b31/clinic-emr/clinic-emr-web:<IMAGE_TAG>`
- Deploys Cloud Run service `clinic-emr-web`.

`scripts/deploy-all.sh`

This is the normal full production deploy. It:

- Creates one shared image tag from Git commit and current time unless `IMAGE_TAG` is already set.
- Runs `scripts/deploy-backend.sh`.
- Resolves the deployed backend URL.
- Runs `scripts/deploy-web.sh`.
- Updates backend `APP_ORIGIN` and `APP_ORIGINS` after web deploy so CORS points at the stable web URL plus canonical Cloud Run URL.

Run full deploy:

```bash
gcloud config configurations activate clinic-emr
./scripts/deploy-all.sh
```

Run with an explicit image tag:

```bash
IMAGE_TAG="$(git rev-parse --short HEAD)-manual" ./scripts/deploy-all.sh
```

Deploy only backend:

```bash
gcloud config configurations activate clinic-emr
./scripts/deploy-backend.sh
```

Deploy only web:

```bash
gcloud config configurations activate clinic-emr
./scripts/deploy-web.sh
```

## `.env.deploy`

`.env.deploy` is gitignored and should stay local only. It contains deploy configuration and Secret Manager resource names, not raw production secret values.

Required values:

```bash
export DATABASE_URL_SECRET_NAME='clinic-emr-database-url'
export AUTH_SECRET_NAME='clinic-emr-auth-secret'
export SUPER_ADMIN_TOTP_SECRET_NAME='clinic-emr-super-admin-totp-secrets'
export SUPER_ADMIN_IDENTIFIERS='dhairya911@gmail.com'
```

Common non-secret values usually stored there as well:

```bash
export PROJECT_ID='project-e8d0eb79-8682-4bd9-b31'
export REGION='asia-south1'
export AR_REPO='clinic-emr'
export BACKEND_SERVICE='clinic-emr-backend'
export WEB_SERVICE='clinic-emr-web'
export SQL_CONNECTION_NAME='project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod'
export DB_NAME='clinic_emr'
export DB_USER='clinic_app'
export GCS_BUCKET='clinic-emr-patient-attachments-prod'
export BACKEND_SA='clinic-emr-backend@project-e8d0eb79-8682-4bd9-b31.iam.gserviceaccount.com'
export BACKEND_PUBLIC_URL='https://clinic-emr-backend-388811826415.asia-south1.run.app'
export WEB_URL='https://clinic-emr-web-388811826415.asia-south1.run.app'
```

If `.env.deploy` is missing, the deploy script will refuse to run because required Secret Manager names are unset.

If Cloud Scheduler follow-up reminders are enabled, store the raw scheduler token in Secret Manager and configure:

```bash
export INTERNAL_SCHEDULER_SECRET_NAME='clinic-emr-internal-scheduler-token'
```

The backend deploy script only injects `INTERNAL_SCHEDULER_TOKEN` when this secret name is non-empty, so keep it in `.env.deploy` after the scheduler is created.

## Follow-Up Reminder Scheduler

Production uses Cloud Scheduler rather than the in-process Cloud Run loop.

Backend runtime setting:

```bash
FOLLOW_UP_REMINDER_RUNNER_ENABLED=false
```

Scheduler job:

```text
name: clinic-emr-follow-up-reminders
region: asia-south1
schedule: 0 8 * * *
time zone: Asia/Kolkata
target: POST https://clinic-emr-backend-388811826415.asia-south1.run.app/internal/run-follow-up-reminders
auth: X-Internal-Token header matching backend INTERNAL_SCHEDULER_TOKEN
```

The endpoint performs follow-up maintenance for all orgs:

- Cancels stale scheduled appointments before the clinic-local day start.
- Cancels stale scheduled follow-ups before the clinic-local day start.
- Sends due follow-up reminder emails for follow-ups that have not already been reminded.

Inspect the scheduler job:

```bash
gcloud scheduler jobs describe clinic-emr-follow-up-reminders \
  --location=asia-south1 \
  --format='table(name,schedule,timeZone,state,httpTarget.uri)'
```

List scheduler jobs:

```bash
gcloud scheduler jobs list --location=asia-south1
```

Do not manually run the scheduler job unless a live reminder send is intended:

```bash
gcloud scheduler jobs run clinic-emr-follow-up-reminders --location=asia-south1
```

That command can send real patient reminder emails if due follow-ups exist.

## Deploy Verification

After every deploy, verify:

```bash
curl -sS https://clinic-emr-backend-388811826415.asia-south1.run.app/health
curl -I -sS https://clinic-emr-web-388811826415.asia-south1.run.app
gcloud run services list --region=asia-south1
```

Expected backend health:

```json
{"status":"ok"}
```

Check recent backend logs:

```bash
gcloud run services logs read clinic-emr-backend --region=asia-south1 --limit=100
```

Check recent web logs:

```bash
gcloud run services logs read clinic-emr-web --region=asia-south1 --limit=100
```

## Known Deploy Details

`APP_ORIGINS` contains multiple URLs separated by commas. `gcloud --set-env-vars` treats commas as separators, so the deploy scripts use custom delimiter syntax:

```bash
--set-env-vars="^@^APP_ORIGINS=${WEB_ORIGINS}"
--update-env-vars="^@^APP_ORIGIN=${WEB_URL}@APP_ORIGINS=${WEB_ORIGINS}"
```

Do not replace that with plain comma syntax, or backend deploys will fail when multiple origins are present.

Cloud Build source upload currently works reliably when impersonation is temporarily disabled and commands run as `dhairya911@gmail.com` owner. The deploy-agent has Cloud Run, logs, SQL, Scheduler, Secret Manager, Artifact Registry, Cloud Build, Service Usage, and Storage Object roles, but source upload to the Cloud Build staging bucket may still fail under impersonation in this project.

If that happens:

```bash
gcloud config unset auth/impersonate_service_account --quiet
./scripts/deploy-all.sh
gcloud config set auth/impersonate_service_account \
  clinic-emr-deploy-agent@project-e8d0eb79-8682-4bd9-b31.iam.gserviceaccount.com
```

Always restore impersonation after deploy.

## Safety Checklist

Before any deploy, migration, or production-changing command, run:

```bash
gcloud config configurations list
gcloud config get-value account
gcloud config get-value project
gcloud config get-value auth/impersonate_service_account
```

For Clinic EMR production work, the active config should be `clinic-emr`, project should be `project-e8d0eb79-8682-4bd9-b31`, and impersonation should point to `clinic-emr-deploy-agent`.
