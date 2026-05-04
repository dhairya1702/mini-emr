# Clinic EMR

Clinic-focused EMR covering queue management, appointments and check-in, patient timelines, follow-ups, billing and invoices, inventory, audit logs, clinic letters, AI-assisted note workflows, and a hidden superuser operations dashboard.

## Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS
- Backend: FastAPI
- Database: Supabase PostgreSQL
- AI: Anthropic Claude

## Structure

```text
web/      Next.js frontend
backend/  FastAPI API
supabase/ SQL schema
```

## Frontend setup

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

## Frontend E2E smoke tests

The repo now includes a mocked Playwright smoke suite for core browser flows. It does not require a live backend seed because API calls are intercepted inside the browser tests.

```bash
cd web
npx playwright install chromium
npm run test:e2e
```

Use headed mode while developing selectors or debugging a failing flow:

```bash
cd web
npm run test:e2e:headed
```

## Backend setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

## Run both servers

From the project root:

```bash
./dev.sh
```

This starts the backend on `http://127.0.0.1:8001` and the frontend dev server from `web/`. Press `Ctrl+C` once to stop both.

## Environment

Frontend:

- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8001`

Backend:

- `SUPABASE_URL=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `AUTH_SECRET=...` required and must stay fixed across restarts so signed sessions remain valid
- `ANTHROPIC_API_KEY=...`
- `ANTHROPIC_MODEL=claude-sonnet-4-20250514`
- `APP_ORIGIN=http://127.0.0.1:3000`
- `SUPER_ADMIN_IDENTIFIERS=you@example.com` optional, comma-separated allowlist for the hidden `/superuser` dashboard
- `FOLLOW_UP_REMINDER_RUNNER_ENABLED=false`
- `FOLLOW_UP_REMINDER_INTERVAL_SECONDS=300`

## Follow-up reminders

Two supported modes:

- In-process runner:
  only enable `FOLLOW_UP_REMINDER_RUNNER_ENABLED=true` on one dedicated backend process if you intentionally want the web app process to send reminders.
- Cron/job runner:
  keep `FOLLOW_UP_REMINDER_RUNNER_ENABLED=false` on the web process and run:

```bash
cd backend
python3 -m app.tasks.send_follow_up_reminders
```

Example cron entry every 5 minutes:

```cron
*/5 * * * * cd /path/to/repo/backend && /path/to/python3 -m app.tasks.send_follow_up_reminders >> /tmp/clinic-followups.log 2>&1
```

## Architecture

- The frontend only talks to the FastAPI backend over HTTP.
- All database access and AI provider access live in the backend.
- Supabase credentials and Anthropic credentials are only used by the backend.
- Sessions are custom backend-signed tokens with a 30-day TTL, returned in both cookies and `X-Session-Token` headers.
- Authenticated API requests reissue fresh session headers, so the app behaves like a sliding session while the user is active.
- The frontend mirrors session state in `localStorage` and refreshes/clears it based on `X-Session-Expires-At`, but the backend remains the source of truth.

## Product Surface

- Queue and patient visit management
- Appointment scheduling, duplicate preview, and atomic check-in
- Clinic-configured booking hours and per-hour capacity for follow-up self-booking
- Patient timelines combining visits, appointments, notes, invoices, and follow-ups
- Draft, finalized, amended, and sent consultation notes
- Per-user account details and per-user document signatures
- Clinic letter generation and PDF rendering
- Billing, invoice finalization, and invoice PDF export
- Inventory and stock adjustment
- Audit events and staff/user management
- Org-scoped authentication with admin and staff roles
- Hidden `/superuser` dashboard for platform org/user visibility and recent backend errors

## Database

Run the SQL in `supabase/schema.sql` in your Supabase project.

If your database is already live, do not assume only `clinic_settings` and `clinic_users` are needed. The current app also depends on:

- `organizations`
- `appointments`
- `patient_visits`
- `follow_ups`
- `catalog_items`
- `invoices`
- `invoice_items`
- `audit_events`
- `platform_errors`
- note versioning and snapshot fields in `notes`
- clinic scheduling fields in `clinic_settings`:
  - `appointment_start_time`
  - `appointment_end_time`
  - `appointments_per_hour`

## Roles

- Admin users can manage staff, billing, inventory, audit logs, note generation/finalization, invoice sharing, and consultation-start transitions.
- Staff users can work patient-facing flows but are redirected away from admin surfaces and blocked from admin-only transitions.

## Notes And Letters

- `POST /generate-note` persists note drafts when `patient_id` is present and can create new drafts, update draft versions, or create amendments from finalized notes.
- `POST /notes/finalize` finalizes a stored consultation note.
- `GET /patients/{patient_id}/notes` returns note history and versions.
- `GET /notes/{note_id}/pdf` renders a saved note snapshot.
- If no Anthropic key is configured, the backend returns deterministic structured clinical text so setup and testing still work.
- `POST /generate-letter` and `POST /generate-letter-pdf` use the same clinic branding settings as notes and invoices.
- Generated note PDFs, saved note PDFs, generated letter PDFs, and sent letters all use the current logged-in user's name and signature when available.
- Uploaded signatures are normalized into transparent PNGs before storage so document rendering can place them cleanly.

## Sharing And Billing

- `POST /send-note` marks a note as sent and writes an audit event.
- `POST /send-letter` is the lightweight mock/share endpoint.
- `POST /send-invoice` finalizes the invoice, records stock deductions for tracked items, and writes an audit event.
- `GET /settings/clinic` and `PUT /settings/clinic` manage clinic branding, doctor details, and PDF header/footer text.
- Medicine quantities in consultation treatment tables feed into billing quantities, and tracked inventory deductions happen from finalized invoice item quantities.

## Superuser

- The hidden superuser dashboard lives at `/superuser`.
- It is not linked anywhere in the normal clinic UI.
- Access is enforced server-side through `SUPER_ADMIN_IDENTIFIERS`.
- It provides:
  - organization summaries
  - org-specific user lists and usage totals
  - recent platform errors from `platform_errors`
  - destructive delete actions for orgs and users
