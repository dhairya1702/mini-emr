# Production release runbook

This runbook intentionally separates preparation from production promotion.
Never paste secret values into a terminal command that will be logged.

## 1. Preflight

```bash
python3 scripts/validate-env.py .env.deploy backend/.env web/.env.local
backend/.venv/bin/python -m pytest -q
cd web && npm run lint && npm run build && npm audit --omit=dev
```

Confirm `git status --short` is empty and create the release commit before proceeding.

## 2. Rotate the scheduler credential

The existing scheduler credential was exposed during diagnostics and must be
rotated before promotion. Generate a new random value in a secure password
manager, add it as a new version of the configured Secret Manager secret, then
update the scheduler's `X-Internal-Token` header to the same value. Do not print
the value or save it in this repository.

After updating both consumers, force a new backend revision so Cloud Run reads
the latest secret version. Verify the scheduler URI points to the current
backend service URL returned by:

```bash
gcloud run services describe clinic-emr-backend \
  --project=project-e8d0eb79-8682-4bd9-b31 \
  --region=asia-south1 \
  --format='value(status.url)'
```

Do not manually execute the reminder job against live patients during a smoke test.

## 3. Prepare release candidates

```bash
./scripts/deploy-all.sh
```

This builds immutable Git-SHA images, runs the migration Cloud Run job, and
creates backend and web revisions with zero production traffic. Any migration
or build failure stops the process.

## 4. Validate without production traffic

Record the candidate revision names printed by the scripts. Assign temporary
Cloud Run tags to those revisions, then verify:

- backend `/health/live` returns 200;
- backend `/health/ready` returns 200 and has no pending migrations;
- login, clinic settings, patient listing, queue listing, and a read-only PDF
  download work against a dedicated non-patient smoke-test organization;
- platform error logs show no new schema, authentication, or storage errors.

Do not send email, modify real patient records, or run the reminder scheduler as
part of validation.

## 5. Promote and roll back

Shift backend traffic first, observe errors and latency, then shift web traffic.
Use explicit revision names with `gcloud run services update-traffic`; never use
an implicit `latest` target. Retain the previous revisions as rollback targets.

Rollback application traffic by assigning 100% to the previous backend and web
revisions. Database migrations in this release are additive and must not be
rolled back destructively; deploy a forward-compatible corrective migration if
one is required.
