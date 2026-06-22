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

## Safety Checklist

Before any deploy, migration, or production-changing command, run:

```bash
gcloud config configurations list
gcloud config get-value account
gcloud config get-value project
gcloud config get-value auth/impersonate_service_account
```

For Clinic EMR production work, the active config should be `clinic-emr`, project should be `project-e8d0eb79-8682-4bd9-b31`, and impersonation should point to `clinic-emr-deploy-agent`.
