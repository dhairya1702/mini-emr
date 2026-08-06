# Backend Operations Scripts

## Organization Showcase Data Loader

`seed_showcase_org.py` adds a deterministic, optometry-focused dataset to the
organization belonging to an existing clinic user. It is intended for preparing
an established organization for product demonstrations and workflow testing.

The loader is additive:

- It resolves the target organization from a clinic user's login identifier.
- It requires the resolved organization to use the `optometry` specialty.
- It requires an exact organization-ID confirmation before retaining changes.
- It does not delete patients or reset organization data.
- It does not change users, passwords, clinic settings, or existing records.
- It uses stable UUIDs, so rerunning the same loader version does not duplicate
  its patients, visits, tests, notes, invoices, appointments, or follow-ups.
- If a catalog item with the same name already exists, the loader reuses it.
- It refreshes only the two case-study narratives owned by the loader.

### Dataset contents

The current dataset adds:

- 15 patients with natural names;
- 18 complete eye examinations, including three previous evaluations;
- contact-lens, binocular-vision, low-vision, and Neurovision/TBI evaluations;
- 12 longitudinal myopia measurements;
- optometry history for every added patient;
- 11 finalized consultation notes;
- 10 service and medicine catalog entries;
- eight invoices with paid, partial, and unpaid examples;
- six appointments;
- six scheduled follow-ups and one completed follow-up;
- two completed case studies.

Every added patient currently uses:

```text
clinicos.notifications@gmail.com
```

Change `TARGET_EMAIL` in the loader only when a different controlled inbox is
explicitly required. Review that change before applying it to production.

### Follow-up reminder behavior

The loader does not invoke the internal reminder endpoint, run Cloud Scheduler,
or call the email sender directly. It inserts normal scheduled follow-up rows
with `reminder_sent_at` unset. The existing application workflow claims and
sends them when the production scheduler reaches the configured reminder
window.

This means:

- due follow-up emails are exercised through the real scheduled workflow;
- future follow-ups remain pending until their normal reminder window;
- rerunning the same loader does not create another copy of a follow-up that was
  already sent;
- invoice and consultation-note emails are not automatic and still require the
  normal **Send invoice** or **Send note** action in the UI.

The loader does not configure or disable WhatsApp. The current seeded phone
values are non-routable placeholders and should not be replaced with real phone
numbers unless the numbers are controlled by the operator.

## Production procedure

Follow the repository cloud runbooks and use the documented Cloud SQL proxy.
Do not print `DATABASE_URL` or any other secret value.

### 1. Verify the active GCP target

```bash
gcloud config configurations list
gcloud config get-value account
gcloud config get-value project
gcloud config get-value run/region
gcloud config get-value auth/impersonate_service_account
```

The expected production target is documented in the repository `AGENTS.md` and
`GCP_DEPLOYMENT.md`. Stop if any value is unexpected.

Check whether the proxy port is already occupied:

```bash
lsof -nP -iTCP:5433 -sTCP:LISTEN
```

If necessary, start the proxy in a separate terminal:

```bash
cloud-sql-proxy --port 5433 project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod
```

### 2. Load the backend environment

From the repository root:

```bash
set -a
source backend/.env
set +a
```

### 3. Run the read-only dry run

```bash
backend/.venv/bin/python backend/scripts/seed_showcase_org.py \
  --identifier clinic-admin@example.com
```

The output includes the resolved organization name, organization ID, specialty,
email-sender mode, and existing record counts. It does not print passwords or
secret configuration.

Confirm all of the following before continuing:

- the organization name is correct;
- the organization ID is correct;
- the specialty is `optometry`;
- the displayed existing counts are plausible;
- the planned recipient inbox is correct.

### 4. Validate the complete transaction and roll it back

Copy the organization ID from the dry-run output:

```bash
backend/.venv/bin/python backend/scripts/seed_showcase_org.py \
  --identifier clinic-admin@example.com \
  --validate-rollback \
  --confirm-org-id 00000000-0000-0000-0000-000000000000
```

This executes the complete insert and verification sequence inside a production
database transaction, then explicitly rolls it back. Use it to catch schema,
constraint, and relationship problems without retaining records.

After validation, rerun the read-only dry run and confirm that the existing
counts did not change.

### 5. Apply the dataset

```bash
backend/.venv/bin/python backend/scripts/seed_showcase_org.py \
  --identifier clinic-admin@example.com \
  --apply \
  --confirm-org-id 00000000-0000-0000-0000-000000000000
```

The apply operation commits only after the full insert and verification sequence
succeeds. Existing organization rows are preserved.

### 6. Verify the retained records

```bash
backend/.venv/bin/python backend/scripts/seed_showcase_org.py \
  --identifier clinic-admin@example.com \
  --verify-only
```

The verification report checks:

- patients, notes, invoices, follow-ups, tests, myopia measurements, and
  appointments;
- the breakdown of clinical track types;
- paid, partial, and unpaid invoice counts;
- scheduled and completed follow-up counts;
- pending reminder emails;
- patient-email mismatches;
- visible `demo`, `synthetic`, or `showcase` labels in seeded clinical records.

Finally, verify the backend health endpoint and stop the manually started proxy:

```bash
curl -sS https://clinic-emr-backend-388811826415.asia-south1.run.app/health
```

Use `Ctrl-C` in the proxy terminal after all database checks are complete.

## Safe reruns and changes

The UUID namespace includes `SEED_VERSION`. With the version unchanged, reruns
are idempotent. Changing `SEED_VERSION` creates a logically new dataset and can
duplicate visible records. Treat a version change as a new production data load:
review it, dry-run it, run rollback validation, and obtain explicit approval
before applying it.

Do not use broad cleanup SQL to remove loader data. If cleanup is ever needed,
build a separate guarded operation that resolves the exact stable IDs and shows
the affected row counts before deleting anything.
