# GCP Migration Handoff

## Current Branch

- Branch: `gcp-migration`
- Last pushed commit: `5c11bf6 Add Postgres repository backend for GCP migration`
- Remote branch: `origin/gcp-migration`
- PR URL: `https://github.com/dhairya1702/mini-emr/pull/new/gcp-migration`

## What Was Completed

- Added `DATABASE_BACKEND` support:
  - Default remains `supabase`.
  - `DATABASE_BACKEND=postgres` selects the new composed `PostgresRepository`.
- Added `STORAGE_BACKEND` support:
  - Default remains `supabase`.
  - `STORAGE_BACKEND=gcs` selects GCS attachment byte storage.
- Added Cloud SQL-compatible schema:
  - `db/schema.sql`
  - `db/README.md`
- Added Postgres connection manager:
  - `backend/app/postgres.py`
- Added GCS/Supabase attachment storage boundary:
  - `backend/app/storage.py`
- Ported every repository method from Supabase to Postgres under:
  - `backend/app/repositories/postgres/`
- Added a composed `PostgresRepository` in:
  - `backend/app/db.py`
- Updated routes/services to depend on neutral `AppRepository`.
- Added migration audit:
  - `GCP_MIGRATION_AUDIT.md`
- Added repository and architecture tests:
  - `tests/test_postgres.py`
  - updated `tests/test_architecture.py`
  - updated attachment storage tests

## Verification Already Run

- `python3 -m compileall backend/app`
- `python3 -m pytest tests/test_postgres.py tests/test_architecture.py tests/test_attachments.py -q`
- `python3 -m pytest tests -q`
- Final full suite result before commit: `183 passed`
- Method parity check:
  - `SupabaseRepository`: 85 async public methods
  - `PostgresRepository`: 85 async public methods
  - Missing methods: none

## Important Implementation Notes

- Runtime still defaults to Supabase until env is changed.
- Postgres code uses direct SQL plus existing Cloud SQL-compatible PostgreSQL functions in `db/schema.sql`.
- Atomic flows kept in SQL functions:
  - `check_in_appointment_atomic`
  - `create_invoice_atomic`
  - `finalize_invoice_atomic`
  - `list_invoices_with_details`
  - `get_patient_timeline_source`
- Dynamic update methods in Postgres repos were hardened with allowlists.
- FastAPI lifespan closes the Postgres pool on shutdown when `DATABASE_BACKEND=postgres`.

## Remaining Work For Next Session

1. Create a real local Postgres or Cloud SQL test database.
2. Apply schema:

   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```

3. Run backend against Postgres:

   ```bash
   DATABASE_BACKEND=postgres
   DATABASE_URL=postgresql://...
   ```

4. If testing GCS attachments:

   ```bash
   STORAGE_BACKEND=gcs
   GCS_PATIENT_ATTACHMENTS_BUCKET=...
   ```

5. Perform real smoke tests:
   - register/login
   - create patient
   - appointment check-in
   - note draft/final/send
   - billing invoice create/finalize
   - attachment upload/download
   - myopia/longitudinal/case-study flows
   - superuser org/error views

6. Plan data migration:
   - Supabase Postgres export
   - Cloud SQL import
   - Supabase Storage files to GCS
   - cutover and rollback checklist

## Known Residual Risk

- The Postgres repositories are covered by fake-pool unit tests, not a real database integration test yet.
- The next high-value validation is running the app against an actual Postgres instance with `db/schema.sql` applied.
