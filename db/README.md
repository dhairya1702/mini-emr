# Database Schema

`schema.sql` is the PostgreSQL schema target for local Postgres and Cloud SQL.

For local Postgres or Cloud SQL, apply it with:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Configure the backend with:

```bash
DATABASE_URL=postgresql://clinic_user:clinic_password@127.0.0.1:5432/clinic_db
GCS_PATIENT_ATTACHMENTS_BUCKET=your-gcs-patient-attachments-bucket
```

The app uses PostgreSQL for metadata and Google Cloud Storage for attachment bytes.
