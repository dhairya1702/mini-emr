# Migrations

Standalone, incremental SQL changes for databases that are **already live**.

`../schema.sql` remains the full schema target for fresh databases (it already
includes everything here). These files exist so you can apply a single change to
an existing Cloud SQL / Postgres instance without re-running the whole schema.

Each migration is idempotent (`add column if not exists`, etc.) and wrapped in a
transaction, so it is safe to run more than once.

Apply one with:

```bash
psql "$DATABASE_URL" -f db/migrations/<file>.sql
```

## Index

| Date       | File                                  | Summary                                        |
| ---------- | ------------------------------------- | ---------------------------------------------- |
| 2026-06-24 | `2026-06-24_patient_ai_summary.sql`   | Adds `ai_summary`, `ai_summary_updated_at`, `ai_summary_stale` to `patients` for the AI chart summary cache. |
| 2026-06-24 | `2026-06-24_customer_onboarding.sql`  | Adds approved customer/CID onboarding records for gated clinic signup. |
| 2026-06-27 | `2026-06-27_auth_hardening.sql`       | Adds revocable per-user session versions. |
| 2026-06-27 | `2026-06-27_rate_limits.sql`          | Adds shared, atomic API rate-limit counters. |
| 2026-06-27 | `2026-06-27_patient_summary_revision.sql` | Prevents stale AI summary writes from winning races. |
| 2026-06-27 | `2026-06-27_financial_precision.sql`  | Converts money and stock quantities to fixed-precision numerics. |
| 2026-06-27 | `2026-06-27_api_request_metrics.sql`  | Adds daily request/error counters for a real platform error rate. |
| 2026-06-27 | `2026-06-27_tenant_integrity.sql`     | Enforces same-organization references for clinical child records. |
