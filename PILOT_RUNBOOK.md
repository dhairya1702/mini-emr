# Pilot Runbook

This project is pilot-ready for a supervised clinic rollout. Use this file as the minimum operational reference during the pilot.

## Before Go-Live

- Confirm backend env vars are set:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `AUTH_SECRET`
  - `APP_ORIGIN`
  - `FOLLOW_UP_REMINDER_RUNNER_ENABLED`
  - `FOLLOW_UP_REMINDER_INTERVAL_SECONDS`
- Confirm frontend env var is set:
  - `NEXT_PUBLIC_API_BASE_URL`
- Keep `AUTH_SECRET` fixed across deploys. Changing it invalidates all active sessions.
- Apply the current database schema from [supabase/schema.sql](/Users/dhairyalalwani/PycharmProjects/mr/supabase/schema.sql).
- Verify clinic sender settings with a real inbox if note, invoice, or follow-up emails are enabled.
- Confirm Supabase backups are enabled and that you know the restore path in the Supabase dashboard.

## Post-Deploy Smoke Check

Run these checks after every deploy:

1. Open the app and log in as an admin user.
2. Confirm `GET /health` returns `{"status":"ok"}`.
3. Create a patient.
4. Create an appointment.
5. Move the appointment to queue.
6. Open a consultation and save or finalize a note.
7. Generate or send an invoice.
8. Create or reschedule a follow-up.
9. Open the audit page and confirm recent actions appear.

## Daily Pilot Checks

- Check backend logs for unhandled exceptions.
- Check clinic feedback for:
  - unexpected logouts
  - appointment check-in failures
  - follow-up booking failures
  - PDF generation failures
  - email send failures
- Spot-check audit events for recent activity.

## If Something Breaks

### Login or Random Logout

- Confirm the deployed backend is using the intended `AUTH_SECRET`.
- Confirm frontend and backend origins are correct.
- Check whether authenticated requests are returning `x-session-token` and `x-session-expires-at`.
- Ask the user what action they were taking when `Authentication required.` appeared.

### Appointment Check-In or Move To Queue Fails

- Inspect the backend error first.
- Confirm the database has only the current `check_in_appointment_atomic` function shape.
- Re-apply [supabase/schema.sql](/Users/dhairyalalwani/PycharmProjects/mr/supabase/schema.sql) if schema drift is suspected.

### Follow-Up Booking Fails

- Confirm clinic booking settings are present:
  - `appointment_start_time`
  - `appointment_end_time`
  - `appointments_per_hour`
- Confirm the public booking token is valid and not expired.
- Check whether the chosen slot is already full.

### PDF Generation Fails

- Check clinic document template settings.
- Verify the uploaded template still exists and is valid.
- Re-test note, letter, or invoice generation directly in the app.

### Email Sending Fails

- Confirm `sender_email` and `sender_email_app_password` are configured in clinic settings.
- Verify the recipient email address is valid.
- Check backend logs for the send failure message.

## Rollback

- Keep track of the exact Git commit deployed to the pilot environment.
- If a release introduces a blocking issue, redeploy the previous known-good commit first.
- After rollback, repeat the post-deploy smoke check.

## Pilot Rules

- Start with one clinic.
- Stay reachable while the clinic is using the product.
- Prefer small fixes over new feature work during the first pilot week.
- If a production DB fix is needed, update [supabase/schema.sql](/Users/dhairyalalwani/PycharmProjects/mr/supabase/schema.sql) immediately so the repo stays authoritative.
