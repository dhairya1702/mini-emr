# Database Schema

`schema.sql` is the Cloud SQL PostgreSQL-compatible schema target for the GCP migration branch.

It is derived from `supabase/schema.sql` with the Supabase-only `storage.buckets` setup removed. The regular app tables, indexes, and PostgreSQL functions remain in place.

For local Postgres or Cloud SQL, apply it with:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Runtime switching is wired through `DATABASE_BACKEND`:

```bash
DATABASE_BACKEND=postgres
DATABASE_URL=postgresql://clinic_user:clinic_password@127.0.0.1:5432/clinic_db
```

For attachment bytes, switch storage separately:

```bash
STORAGE_BACKEND=gcs
GCS_PATIENT_ATTACHMENTS_BUCKET=your-gcs-patient-attachments-bucket
```

The schema and repository code are ready for Postgres, but production config, credentials, data import, and attachment file migration still need to be supplied during cutover.
