# GCP Cutover Checklist

This file is the concrete follow-through for the migration work already documented in [HANDOFF_GCP_MIGRATION.md](/Users/dhairyalalwani/PycharmProjects/mr/HANDOFF_GCP_MIGRATION.md) and [GCP_MIGRATION_AUDIT.md](/Users/dhairyalalwani/PycharmProjects/mr/GCP_MIGRATION_AUDIT.md).

The application code is already dual-stack capable. The remaining work is to prove the Postgres and GCS paths in a real environment, switch the repo defaults to GCP-oriented settings, and remove Supabase from runtime.

## Current State

- Postgres repository code exists in [backend/app/repositories/postgres](/Users/dhairyalalwani/PycharmProjects/mr/backend/app/repositories/postgres).
- Runtime can switch between Supabase and Postgres in [backend/app/db.py](/Users/dhairyalalwani/PycharmProjects/mr/backend/app/db.py).
- Attachment storage can switch between Supabase and GCS in [backend/app/storage.py](/Users/dhairyalalwani/PycharmProjects/mr/backend/app/storage.py).
- Cloud SQL schema exists in [db/schema.sql](/Users/dhairyalalwani/PycharmProjects/mr/db/schema.sql).
- The repo still defaults to Supabase in [backend/.env.example](/Users/dhairyalalwani/PycharmProjects/mr/backend/.env.example) and [backend/app/config.py](/Users/dhairyalalwani/PycharmProjects/mr/backend/app/config.py).
- Top-level operational docs still describe Supabase as the main stack in [README.md](/Users/dhairyalalwani/PycharmProjects/mr/README.md) and [PILOT_RUNBOOK.md](/Users/dhairyalalwani/PycharmProjects/mr/PILOT_RUNBOOK.md).

## Definition Of Done

The migration is done when all of the following are true:

1. The backend runs only with `DATABASE_BACKEND=postgres`.
2. Patient attachment bytes run only with `STORAGE_BACKEND=gcs`.
3. Core workflows have been smoke-tested against a real Postgres database and a real GCS bucket.
4. Production and pilot docs no longer tell operators to use Supabase.
5. A reproducible data migration path exists for database rows and attachment files.
6. GCP deploy artifacts exist for the backend, frontend, and reminder runner.
7. Supabase runtime code and the `supabase` dependency are removed.

## Phase 1: Prove The GCP Runtime Paths

Goal: validate that the existing Postgres and GCS code actually works outside unit tests.

### Tasks

1. Create a real Postgres database and apply [db/schema.sql](/Users/dhairyalalwani/PycharmProjects/mr/db/schema.sql).
2. Start the backend with:
   - `DATABASE_BACKEND=postgres`
   - `DATABASE_URL=...`
3. Create a real GCS bucket and start the backend with:
   - `STORAGE_BACKEND=gcs`
   - `GCS_PATIENT_ATTACHMENTS_BUCKET=...`
4. Run real smoke tests for:
   - register/login
   - create patient
   - appointment create and check-in
   - note generate/finalize/send
   - invoice create/finalize/send
   - attachment upload/download
   - follow-up create/public booking
   - case study generation
   - mobile consultation finalize
   - superuser org and error views

### Repo Changes Needed

- Add an explicit integration runbook under the repo root or `db/`, for example `GCP_VALIDATION_RUNBOOK.md`.
- Add a backend integration test target that is intended for real Postgres, separate from the current fake-pool tests in [tests/test_postgres.py](/Users/dhairyalalwani/PycharmProjects/mr/tests/test_postgres.py).
- Add a storage integration test target for GCS, separate from the current fake-client tests in [tests/test_attachments.py](/Users/dhairyalalwani/PycharmProjects/mr/tests/test_attachments.py).

### Exit Criteria

- The app is exercised end-to-end with `DATABASE_BACKEND=postgres` and `STORAGE_BACKEND=gcs`.
- There are no calls to Supabase in the successful runtime path.

## Phase 2: Make GCP The Default Repo Story

Goal: stop presenting Supabase as the normal stack.

### Tasks

1. Update [README.md](/Users/dhairyalalwani/PycharmProjects/mr/README.md):
   - change the stack line from `Supabase PostgreSQL` to `PostgreSQL (Cloud SQL target)`
   - change setup instructions to use [db/schema.sql](/Users/dhairyalalwani/PycharmProjects/mr/db/schema.sql)
   - document `DATABASE_BACKEND=postgres`
   - document `STORAGE_BACKEND=gcs`
   - document that Supabase is transitional only, or remove it entirely once Phase 6 is done
2. Update [PILOT_RUNBOOK.md](/Users/dhairyalalwani/PycharmProjects/mr/PILOT_RUNBOOK.md):
   - replace `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with `DATABASE_URL`
   - replace `supabase/schema.sql` references with `db/schema.sql`
   - replace Supabase backup language with Cloud SQL backup/restore language
3. Update [backend/.env.example](/Users/dhairyalalwani/PycharmProjects/mr/backend/.env.example):
   - switch defaults to `DATABASE_BACKEND=postgres`
   - switch defaults to `STORAGE_BACKEND=gcs`
   - demote Supabase env vars to optional legacy migration notes, or remove them once Phase 6 is done
4. Update [db/README.md](/Users/dhairyalalwani/PycharmProjects/mr/db/README.md) if needed to become the primary schema setup doc.

### Repo Changes Needed

- [README.md](/Users/dhairyalalwani/PycharmProjects/mr/README.md)
- [PILOT_RUNBOOK.md](/Users/dhairyalalwani/PycharmProjects/mr/PILOT_RUNBOOK.md)
- [backend/.env.example](/Users/dhairyalalwani/PycharmProjects/mr/backend/.env.example)
- possibly [dev.sh](/Users/dhairyalalwani/PycharmProjects/mr/dev.sh) if it currently assumes Supabase-backed local usage

### Exit Criteria

- A new engineer reading the repo should conclude that the intended stack is Postgres + GCS on GCP.

## Phase 3: Add GCP Deployment Artifacts

Goal: make the repo deployable to the intended target stack.

### Tasks

1. Add a backend container definition.
2. Add a frontend container definition.
3. Add deployment config for:
   - backend service
   - frontend service
   - follow-up reminder runner as a Cloud Run Job or Cloud Scheduler-triggered service
4. Decide how database connectivity is handled:
   - direct `DATABASE_URL`
   - or Cloud SQL connector setup
5. Document required secrets and environment variables for GCP.

### Repo Changes Needed

- Add `Dockerfile` for `backend/`
- Add `Dockerfile` for `web/`
- Add `cloudbuild.yaml`, deployment scripts, or Terraform
- Add a GCP setup doc, for example `GCP_DEPLOYMENT.md`

### Exit Criteria

- The repo can be deployed to GCP from checked-in artifacts without ad hoc manual knowledge.

## Phase 4: Plan And Rehearse Data Migration

Goal: replace Supabase as the source of truth without data loss.

### Tasks

1. Define database export/import steps:
   - export Supabase Postgres data
   - import into Cloud SQL Postgres
2. Define attachment file migration steps:
   - enumerate files in Supabase Storage bucket `patient-attachments`
   - copy them into GCS
   - preserve `storage_path` values referenced by `patient_attachments`
3. Define verification queries:
   - row counts per table
   - sample record checks
   - attachment count checks
4. Define rollback:
   - what causes rollback
   - how traffic is moved back
   - how writes are frozen during final cutover

### Repo Changes Needed

- Add a migration runbook, for example `GCP_DATA_MIGRATION.md`
- Add helper scripts if needed under `backend/scripts/` or `db/scripts/`

### Tables To Verify

- `organizations`
- `clinic_users`
- `clinic_settings`
- `patients`
- `patient_visits`
- `appointments`
- `follow_ups`
- `notes`
- `patient_attachments`
- `catalog_items`
- `invoices`
- `invoice_items`
- `audit_events`
- `ai_usage_events`
- `platform_errors`
- `myopia_measurements`
- `longitudinal_tracks`
- `case_studies`

### Exit Criteria

- There is a dry-run migration procedure with verification steps and a rollback path.

## Phase 5: Flip Runtime Defaults To GCP

Goal: make GCP the normal runtime path before deleting legacy code.

### Tasks

1. Change environment defaults and docs to Postgres + GCS.
2. Treat Supabase only as a temporary fallback during cutover.
3. Run the full backend and frontend test suite with GCP-oriented env settings where possible.
4. Run the pilot or staging environment only on Postgres + GCS.

### Repo Changes Needed

- [backend/.env.example](/Users/dhairyalalwani/PycharmProjects/mr/backend/.env.example)
- [README.md](/Users/dhairyalalwani/PycharmProjects/mr/README.md)
- [PILOT_RUNBOOK.md](/Users/dhairyalalwani/PycharmProjects/mr/PILOT_RUNBOOK.md)

### Exit Criteria

- All normal setup instructions use GCP-oriented settings.
- Supabase is no longer required for any staging or pilot environment.

## Phase 6: Remove Supabase From Runtime

Goal: finish the migration and simplify the codebase.

Do not start this phase until Phases 1 through 5 are complete.

### Tasks

1. Remove the Supabase repository path from [backend/app/db.py](/Users/dhairyalalwani/PycharmProjects/mr/backend/app/db.py).
2. Remove the Supabase attachment storage path from [backend/app/storage.py](/Users/dhairyalalwani/PycharmProjects/mr/backend/app/storage.py).
3. Remove Supabase config fields from [backend/app/config.py](/Users/dhairyalalwani/PycharmProjects/mr/backend/app/config.py):
   - `supabase_url`
   - `supabase_service_role_key`
4. Remove the Supabase retry base class in [backend/app/repositories/base.py](/Users/dhairyalalwani/PycharmProjects/mr/backend/app/repositories/base.py) if it is no longer needed.
5. Remove `supabase` from [backend/requirements.txt](/Users/dhairyalalwani/PycharmProjects/mr/backend/requirements.txt).
6. Remove or archive [supabase/schema.sql](/Users/dhairyalalwani/PycharmProjects/mr/supabase/schema.sql) once `db/schema.sql` is the single source of truth.
7. Update tests that still assert Supabase-specific behavior or naming:
   - [tests/test_architecture.py](/Users/dhairyalalwani/PycharmProjects/mr/tests/test_architecture.py)
   - [tests/test_auth.py](/Users/dhairyalalwani/PycharmProjects/mr/tests/test_auth.py)
   - [tests/test_app.py](/Users/dhairyalalwani/PycharmProjects/mr/tests/test_app.py)
   - [tests/test_error_mapping.py](/Users/dhairyalalwani/PycharmProjects/mr/tests/test_error_mapping.py)
   - [tests/test_attachments.py](/Users/dhairyalalwani/PycharmProjects/mr/tests/test_attachments.py)
8. Remove Supabase references from docs:
   - [README.md](/Users/dhairyalalwani/PycharmProjects/mr/README.md)
   - [PILOT_RUNBOOK.md](/Users/dhairyalalwani/PycharmProjects/mr/PILOT_RUNBOOK.md)
   - [GCP_MIGRATION_AUDIT.md](/Users/dhairyalalwani/PycharmProjects/mr/GCP_MIGRATION_AUDIT.md) if parts are no longer current

### Exit Criteria

- The backend cannot be configured to use Supabase anymore.
- The dependency tree contains no Supabase runtime dependency.
- The repo has a single database schema source of truth.

## Immediate Next Moves

If the goal is to make progress with the fewest moving parts, do these next:

1. Stand up a real Postgres database and run the backend against `db/schema.sql`.
2. Stand up a real GCS bucket and validate attachment upload/download.
3. Update docs and env examples so GCP is the default repo story.
4. Add deploy artifacts for backend, frontend, and reminder job.
5. Only after that, remove Supabase runtime code.

## Suggested Execution Order For This Repo

1. Commit [HANDOFF_GCP_MIGRATION.md](/Users/dhairyalalwani/PycharmProjects/mr/HANDOFF_GCP_MIGRATION.md) if it is meant to be durable.
2. Complete Phase 1 validation.
3. Complete Phase 2 docs and defaults.
4. Complete Phase 3 deploy artifacts.
5. Complete Phase 4 migration runbook and rehearsal.
6. Complete Phase 5 default flip in all active environments.
7. Complete Phase 6 code removal.
