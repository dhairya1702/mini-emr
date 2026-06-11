# GCP Migration Audit

Branch: `gcp-migration`

## Current State

The app currently uses Supabase as a backend-only dependency. The Next.js frontend does not talk to Supabase directly; it only calls the FastAPI API through `NEXT_PUBLIC_API_BASE_URL`.

Main Supabase coupling lives in:

- `backend/app/db.py`
- `backend/app/repositories/*`
- `backend/app/config.py`
- `backend/requirements.txt`
- `supabase/schema.sql`
- setup docs and env examples

Auth is not Supabase Auth. The app already owns password hashing, signed session tokens, cookies, session refresh, and role checks in `backend/app/auth.py` and `backend/app/services/auth_flow.py`. That means the GCP migration does not need a full auth product rewrite unless we intentionally choose one.

## Database Coupling

`backend/app/db.py` creates a Supabase sync client with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then exposes it as `SupabaseRepository`.

Every repository mixin uses the Supabase/PostgREST query builder directly:

- `backend/app/repositories/auth_settings.py`: organizations, clinic settings, clinic users
- `backend/app/repositories/patient_flow.py`: patients, visits, appointments, check-in RPC
- `backend/app/repositories/records.py`: notes and follow-ups
- `backend/app/repositories/billing.py`: catalog, invoices, invoice items, billing RPCs
- `backend/app/repositories/attachments.py`: patient attachment metadata and Supabase Storage
- `backend/app/repositories/myopia.py`: myopia measurements
- `backend/app/repositories/specialty_tracks.py`: longitudinal tracks
- `backend/app/repositories/case_studies.py`: case studies
- `backend/app/repositories/audit.py`: audit events
- `backend/app/repositories/ai_usage.py`: AI usage events
- `backend/app/repositories/superuser.py`: platform errors and superuser org views

This means the migration should not try to keep the Supabase query builder. The clean target is a new repository implementation backed by direct PostgreSQL access.

Recommended GCP database target:

- `Cloud SQL for PostgreSQL`
- Python driver: `psycopg` or SQLAlchemy Core/ORM
- Keep the current repository method boundaries so routes/services do not need a broad rewrite

## Schema Surface

The current schema file is `supabase/schema.sql`.

Tables:

- `organizations`
- `patients`
- `notes`
- `patient_attachments`
- `clinic_users`
- `clinic_settings`
- `catalog_items`
- `invoices`
- `invoice_items`
- `audit_events`
- `ai_usage_events`
- `platform_errors`
- `follow_ups`
- `appointments`
- `patient_visits`
- `myopia_measurements`
- `longitudinal_tracks`
- `case_studies`

Postgres functions used through `.rpc(...)`:

- `check_in_appointment_atomic`
- `create_invoice_atomic`
- `finalize_invoice_atomic`
- `list_invoices_with_details`
- `get_patient_timeline_source`
- `list_superuser_org_summaries`

These functions are portable to Cloud SQL PostgreSQL. We can either keep them as database functions or move some logic into repository transactions. The atomic write functions should stay transaction-backed either way.

Supabase-specific schema object:

- `insert into storage.buckets ...`

That line must be removed/replaced during Cloud SQL migration. Cloud SQL will not have Supabase's `storage` schema.

## File Storage Coupling

Patient attachment binary storage is Supabase-specific in `backend/app/repositories/attachments.py`.

Current behavior:

- metadata goes into `patient_attachments`
- bytes are uploaded to Supabase Storage bucket `patient-attachments`
- `storage_path` is stored in the DB
- downloads read bytes from Supabase Storage using `storage_path`

Recommended GCP storage target:

- `Google Cloud Storage`
- bucket such as `clinic-emr-patient-attachments-{env}`
- keep `patient_attachments.storage_path`
- change implementation behind upload/download only

Likely new env:

- `GCS_PATIENT_ATTACHMENTS_BUCKET`
- optionally `GOOGLE_CLOUD_PROJECT`

The frontend attachment behavior should not need changes because it already calls backend endpoints.

## Config And Secrets

Current backend env:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTH_SECRET`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `APP_ORIGIN`
- `APP_ORIGINS`
- `SUPER_ADMIN_IDENTIFIERS`
- `FOLLOW_UP_REMINDER_RUNNER_ENABLED`
- `FOLLOW_UP_REMINDER_INTERVAL_SECONDS`

GCP migration env should replace Supabase keys with:

- `DATABASE_URL`
- `GCS_PATIENT_ATTACHMENTS_BUCKET`
- maybe `INSTANCE_CONNECTION_NAME` if using Cloud SQL connector

Keep:

- `AUTH_SECRET`
- `ANTHROPIC_API_KEY`
- `APP_ORIGIN`
- `APP_ORIGINS`
- follow-up reminder settings

Use Secret Manager for production secrets. Do not bake DB credentials or API keys into container images.

## Hosting Coupling

There is no production GCP deploy setup in the repo yet.

Current local runtime:

- backend: `uvicorn app.main:app`
- frontend: `npm run dev`
- helper: `dev.sh`

Recommended GCP hosting target:

- backend FastAPI: Cloud Run
- frontend Next.js: Cloud Run
- database: Cloud SQL for PostgreSQL
- attachments: Cloud Storage
- background reminders: Cloud Scheduler calling a Cloud Run endpoint or Cloud Run Job

The current in-process reminder loop should stay disabled on normal web/API Cloud Run instances. Cloud Run can scale horizontally, so enabling in-process reminders on multiple instances can send duplicate reminders.

## Tests And Fakes

Most backend tests use an in-memory fake repository in `tests/test_app.py`, which is good for migration. Those tests protect behavior while the repository implementation changes.

Supabase-specific tests to update:

- `tests/test_architecture.py` currently asserts the Supabase sync client import
- `tests/test_attachments.py` imports `postgrest.exceptions.APIError`
- `tests/test_error_mapping.py` uses a Supabase-flavored error message
- auth/config tests reference `supabase_service_role_key`

The test strategy should be:

- keep fake repository behavior tests
- add repository-level integration tests for PostgreSQL if feasible
- update architecture tests to assert the new DB adapter boundary instead of Supabase imports

## Migration Risk Map

High risk:

- replacing all `.table(...)` repository calls
- preserving atomic check-in and invoice behavior
- replacing Supabase Storage upload/download with GCS
- preserving timestamp/timezone behavior

Medium risk:

- translating Supabase `.or_(...)`, `.in_(...)`, `.single()`, and count semantics to SQL
- preserving JSONB fields and response shapes
- preserving superuser aggregate views

Low risk:

- frontend API calls
- app-managed auth/session logic
- AI service integration
- PDF generation
- local UI state

## Recommended Migration Sequence

1. Add new GCP-oriented env names and config without removing Supabase yet.
2. Introduce a repository interface/adapter boundary so routes/services depend on a neutral repository type.
3. Add a PostgreSQL repository implementation using direct SQL.
4. Port schema into migration files for Cloud SQL, removing Supabase Storage objects.
5. Replace patient attachment storage implementation with GCS.
6. Run behavior tests against the fake repository and targeted integration tests against local Postgres.
7. Add Cloud Run Dockerfiles/deploy config for backend and web.
8. Add Cloud SQL/GCS/Secret Manager setup notes or IaC.
9. Perform data export/import rehearsal from Supabase Postgres to Cloud SQL.
10. Cut over with backups, smoke tests, and rollback steps.

## Initial Recommendation

Do not start by editing every repository method. Start by naming the new boundaries:

- rename `SupabaseRepository` toward a neutral `Repository`
- add DB/storage config names
- decide whether to keep SQL functions or move them into Python transaction code
- add a GCS storage service behind the existing attachment routes

The most pragmatic path is to keep PostgreSQL semantics and the current backend API contract, while swapping Supabase-specific client/storage pieces underneath.

## Progress On This Branch

- Added neutral `AppRepository` naming while keeping the current Supabase implementation active.
- Split patient attachment byte storage behind a `PatientAttachmentStorage` boundary.
- Added optional GCS patient attachment storage selected by `STORAGE_BACKEND=gcs`.
- Added `DATABASE_BACKEND`, `DATABASE_URL`, a Cloud SQL-compatible schema copy, and a lazy Postgres connection manager.
- Started isolated Postgres repository coverage with `ai_usage_events` and `audit_events`.
- Added isolated Postgres repository coverage for every current repository slice: auth/settings, patients/appointments/visits, records/follow-ups, billing/catalog/invoices, attachments metadata, myopia, longitudinal tracks, case studies, audit, AI usage, platform errors, and superuser org views.
- Wired `DATABASE_BACKEND=postgres` to select a composed `PostgresRepository`; Supabase remains the default until configuration is changed.
