# Clinic EMR Platform User Guide

This document explains how to use the platform end to end as a clinic user. It is written for someone evaluating the product for the first time, or for a clinic staff member being onboarded.

## What The Platform Does

The app combines the main clinic workflows into one system:

- patient intake and live queue
- appointments and check-in
- consultation notes
- patient chart and attachments
- billing and invoices
- inventory tracking
- follow-ups
- staff/user management
- clinic settings

There are two main experiences:

- desktop web app
- mobile web app

If a user opens the frontend on a phone, the app should route them into the mobile experience automatically.

## Roles

There are three practical role levels in the system.

### Admin

Admin users can:

- manage the queue
- start consultations
- create and finalize notes
- manage billing and invoices
- manage inventory
- manage staff users
- access audit and earnings pages
- update clinic settings

### Staff

Staff users can:

- use patient-facing flows
- work with queue and patient records
- use patient charts and attachments

Staff users are restricted from admin-only areas such as:

- billing admin flows
- inventory management
- user management
- audit
- earnings
- some consultation-start transitions

### Superuser

This is not a normal clinic role. It is a hidden platform operations mode enabled only for allowlisted identifiers.

It is used for:

- viewing all orgs
- inspecting platform errors
- deleting orgs or users when needed

## First Login

When a new clinic admin first opens the app:

1. Open the login page.
2. Choose `Create Account` if the clinic does not exist yet.
3. Enter clinic/admin details and complete registration.
4. Sign in.
5. If prompted, complete specialty onboarding.

Specialty matters because some clinic surfaces are specialty-aware. For example, optometry-specific modules should only appear in optometry clinics.

## Main Navigation

The exact layout differs a little between desktop and mobile, but the core surfaces are the same.

Main areas:

- `Queue`
- `Appointments`
- `Patients`
- `Billing`
- `Inventory`
- `History`
- `Earnings`
- `Users`
- `Account`

Not every user sees every page. Admin-only pages are hidden or blocked for staff.

## Recommended First-Time Setup

An admin should do these setup steps before regular usage:

1. Open `Account`.
2. Confirm profile details are correct.
3. Upload signature if notes, letters, or PDFs should carry a doctor signature.
4. Open clinic settings.
5. Set clinic branding and doctor details.
6. Configure clinic email sender settings if notes or invoices will be emailed.
7. Configure appointment hours and appointments-per-hour if follow-up booking is used.
8. Add staff users if more people will use the system.
9. Add inventory/catalog items if billing should use stock-aware items.

## End-To-End Daily Workflow

This is the simplest way to understand the product.

### 1. Add or find a patient

From `Queue`:

1. Click `Add patient`.
2. Search by phone first if the patient may already exist.
3. If an existing patient is found, load them and fill only the current visit details.
4. If no patient is found, create a new patient with:
   - name
   - phone
   - reason for visit
   - DOB
   - optional weight, temperature, height, email
5. Add them to queue.

Result:

- the patient appears in the waiting queue
- the visit is tied to the clinic org

### 2. Manage the live queue

The queue represents the clinic’s current working state.

Main statuses:

- `waiting`
- `consultation`
- `done`

Typical usage:

1. New arrivals are added into `waiting`.
2. Admin moves a patient into `consultation` to begin the encounter.
3. After consultation, the patient can move to `done`.
4. Billing is then handled from the done/billing workflow.

## Appointments

Appointments can be used alongside the live queue.

Typical appointment flow:

1. Create an appointment for a patient.
2. Review scheduled appointments in the appointments area.
3. At arrival time, check the patient in.
4. Move them into the active clinic queue if appropriate.

The system also supports clinic-configured booking hours and capacity for follow-up scheduling.

## Consultation Workflow

Consultation is one of the core workflows.

### Start consultation

1. Open a patient from queue.
2. Start consultation.
3. Enter clinical details in the consultation form.

Depending on clinic specialty, the consultation may include:

- standard GP note inputs
- optometry-specific structured modules

### Generate note

The platform supports AI-assisted note generation using Gemini on Vertex AI.

Usage:

1. Fill in the relevant consultation context.
2. Click `Generate`.
3. Review the generated note text.
4. Edit it if needed.

Important behavior:

- if Gemini is unavailable, the platform can fall back to a deterministic template-style note
- if that fallback happens, the UI should indicate it instead of pretending AI succeeded

### Save draft and finalize

Notes are draftable.

Typical flow:

1. Generate or type a note draft.
2. Save/update the draft.
3. Finalize the note when complete.

After finalization:

- the note becomes part of the patient history
- the note can be rendered as a PDF
- the note can be shared/emailed if configured

### Sending a note

If note sending is configured:

1. Finalize the note.
2. Use the send/share action.
3. Confirm the recipient.

This writes an audit event and marks the note as shared/sent in the system.

## Patient Chart

Every patient has a chart view that brings together their record over time.

Typical contents:

- visits
- consultation notes
- attachments
- tests or specialty-specific records
- follow-up history
- invoices and billing-related context in timeline/history flows

Use the patient chart to:

- review prior visits
- open older notes
- inspect attachments
- review specialty data like myopia history where applicable

## Attachments

Attachments can come from:

- patient chart uploads
- consultation uploads

Supported file types include:

- images
- PDFs
- videos

### How attachments are used

1. Upload from the patient chart or consultation workflow.
2. The file is stored in cloud storage.
3. The attachment appears inside the patient chart.
4. Users can open it in a separate viewer.

Notes:

- consultation-linked attachments should still appear in the patient chart
- deleting patient-chart attachments should free up storage for those stored media objects
- some mobile-recorded videos may upload successfully but not play in-browser if the device codec is not browser-friendly

## Billing And Invoices

Billing is intentionally a separate workflow from consultation.

### Core behavior

There are three important actions:

- `Create Invoice`
- `Done`
- `Send Email`

### What they mean

`Create Invoice`

- saves or updates a draft invoice
- does not finalize the billing by itself
- should not count earnings twice

`Done`

- finalizes billing without emailing the patient
- use this when the invoice should be recorded but not sent

`Send Email`

- finalizes the same saved invoice and emails it
- use this when the patient should receive the invoice

### Typical billing flow

1. Move patient to the completed/done stage.
2. Open billing.
3. Select the patient.
4. Add service or medicine items.
5. Choose payment status.
6. Click:
   - `Create Invoice` to save draft
   - `Done` to finalize without email
   - `Send Email` to finalize and send

### Inventory behavior

If an invoice contains tracked inventory items:

- stock is adjusted when the invoice is finalized
- draft invoice saves should not deduct stock

## Inventory

Inventory/catalog is mainly for admins.

Use it to manage:

- services
- medicines
- stock quantities
- low stock thresholds
- tracked versus non-tracked items

When a tracked item is billed through a finalized invoice, inventory can decrease automatically.

## Users

Admins can manage staff access from the `Users` page.

Typical actions:

- add a staff or admin user
- change user role
- delete a user

On mobile, there is also a dedicated users page for admins in the left navigation.

## Account

Each logged-in user should review `Account` for:

- profile details
- password updates
- doctor signature upload

The signature is important because generated note PDFs and other clinic documents can use the current user’s signature.

## History

`History` provides a broader cross-patient record of recent work.

Use it to:

- review prior encounters
- reopen older patient work
- inspect completed actions and longitudinal activity

## Earnings

`Earnings` is an admin surface.

It should reflect finalized paid invoice activity, not draft saves.

Use it to:

- understand clinic revenue at a glance
- review paid invoice totals
- track billed work

## Follow-Ups

Follow-ups can be created from clinic workflows and can also support public booking/confirmation flows depending on configuration.

Typical clinic-side follow-up usage:

1. Create a follow-up for a patient.
2. Set date/time or relevant reminder metadata.
3. Track status in the patient timeline or follow-up records.

Public follow-up booking links may also be supported depending on how the clinic is using the feature.

## Mobile Experience

The mobile app is a mobile web experience, not a separate native app.

Expected behavior:

- opening the frontend on a phone should redirect into the mobile route
- queue, patients, history, account, and users should be usable on mobile

Good mobile use cases:

- front-desk intake
- queue movement
- quick patient lookup
- viewing attachments
- lightweight follow-up actions

## Suggested Demo Script For A New User

If you want someone to try the product quickly, ask them to do this:

1. Sign in as an admin.
2. Open `Queue`.
3. Add a new patient.
4. Move the patient into consultation.
5. Generate a consultation note.
6. Finalize the note.
7. Open the patient chart and review the visit.
8. Upload an attachment.
9. Open `Billing`.
10. Add one or two invoice items.
11. Click `Done` or `Send Email`.
12. Open `History`.
13. Open `Earnings`.
14. Open `Users`.
15. Open `Account`.

That gives a good end-to-end sense of the product.

## Common Things To Tell Test Users

- Search by phone before creating a duplicate patient.
- Consultation notes can be drafted first and finalized later.
- Draft invoices are not the same as finalized invoices.
- `Done` finalizes billing without email.
- `Send Email` finalizes and sends the same invoice.
- Attachments live in the patient chart even if uploaded during consultation.
- Staff users will not see all admin pages.

## Known Operational Notes

- Email sending depends on clinic sender settings being configured.
- AI note generation depends on Gemini/Vertex being available.
- If AI is unavailable, the system may fall back to a structured template.
- Follow-up automation depends on scheduler/runner setup.
- Superuser is intentionally hidden and not part of normal clinic usage.

## If You Are Giving This To A Trial User

Give them:

- the app URL
- a test login
- whether they are admin or staff
- whether they should test desktop or mobile
- whether email sending is actually configured in that environment
- whether AI generation is expected to be live in that environment

That avoids confusion during the trial.
