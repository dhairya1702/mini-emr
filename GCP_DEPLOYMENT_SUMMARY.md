# GCP Deployment Summary

- Project: `project-e8d0eb79-8682-4bd9-b31`
- Region: `asia-south1`
- Services:
  - `clinic-emr-backend` on Cloud Run
  - `clinic-emr-web` on Cloud Run
- Database target: Cloud SQL for PostgreSQL
- Attachment storage: GCS bucket `clinic-emr-patient-attachments-prod`
- Reminder mode for now: Cloud Scheduler
- Secret mode for now: environment variables
- Supabase fallback: still present in code, but not intended for the GCP deployment path

Primary guide: [GCP_DEPLOYMENT.md](/Users/dhairyalalwani/PycharmProjects/mr/GCP_DEPLOYMENT.md)
