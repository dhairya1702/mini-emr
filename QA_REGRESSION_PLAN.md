# Clinic App QA and Regression Plan

## Purpose
This document defines the manual QA program and phased automation roadmap for the full clinic application in this repository. It is written against the current implementation in `web/` and the backend route surface in `backend/app/routes/`.

It is intended to be operational: another engineer or QA person should be able to run the test program without inventing missing coverage.

## Scope
- Environments: `dev`, `staging`
- Platforms: desktop-first, mobile/responsive smoke
- Browsers: Chrome/Chromium primary
- Specialties: `general_physician`, `optometry`
- Roles: `admin`, `staff`, `superuser`, anonymous public follow-up user
- Test modes: manual execution plus phased browser automation

## Source-of-Truth Surfaces
The plan is grounded in these current UI routes and shared surfaces:

### Routes
- `/login`
- `/onboarding/specialty`
- `/`
- `/patients`
- `/history`
- `/billing`
- `/inventory`
- `/users`
- `/account`
- `/audit`
- `/earnings`
- `/case-study`
- `/superuser`
- `/follow-up`

### Shared surfaces
- `AppHeader`
- `SettingsDrawer`
- `ConsultationDrawer`
- `PatientDetailsDrawer`
- `AddPatientModal`
- `SettingsDrawerAppointmentsPanel`
- `SettingsDrawerBillingPanel`
- `SettingsDrawerLetterPanel`
- `SettingsDrawerInventoryPanel`
- `SettingsDrawerUsersPanel`
- `ContactLensModal`
- `BinocularVisionModal`
- `LowVisionModal`
- `MyopiaManagementModal`
- `HistoricalMyopiaModal`

### Backend-backed workflows to validate through UI
- auth bootstrap and session redirect
- clinic settings read/update
- patient create/list/edit/timeline
- appointment create/check-in/update
- consultation note generate/finalize/export/send
- follow-up create/update/public booking
- myopia history create/list/update
- case study source/generate/save/export
- invoice create/export/send
- audit list/filter/detail
- exports CSV flows
- superuser org/error dashboards

## Critical Product Facts Discovered in Repo
- `/login` and `/follow-up` are treated as public routes by `ClinicShellProvider`.
- specialty onboarding is enforced via a pending onboarding flag plus missing `clinic_specialty`; once a specialty exists, `/onboarding/specialty` should redirect back to `/`.
- `Case Study` is admin-only in the UI.
- `Inventory`, `Users`, `Audit`, `Billing`, and `Earnings` are admin-only pages in the UI; staff is redirected to `/`.
- backend permission tests also enforce that staff cannot create notes, finalize notes, send notes, list invoices, access users, access audit, access exports, access catalog, create invoices, or start consultation.
- consultation local draft persistence exists via `localStorage` per patient (`consultation-workspace:<patientId>`). This must be tested explicitly.
- queue ordering is also persisted locally via `localStorage` (`clinic_queue_order_v1`).
- optometry-specific modules appear inside consultation and patient chart flows and should not leak into general physician clinics.
- superuser access is backend allowlist based, not just role-label based.

## Test Personas and Fixtures
Use a controlled seeded dataset. Do not rely on ad hoc manually-created records except where the test explicitly says to create one.

### User personas
- `Admin GP Clinic`
  - role: admin
  - clinic specialty: `general_physician`
- `Admin Optometry Clinic`
  - role: admin
  - clinic specialty: `optometry`
- `Staff GP Clinic`
  - role: staff
  - clinic specialty: `general_physician`
- `Staff Optometry Clinic`
  - role: staff
  - clinic specialty: `optometry`
- `Superuser`
  - identifier allowlisted for `/superuser`
- `Public Follow-up Patient`
  - valid public follow-up booking link token

### Patient fixtures
- `P-NEW-GP`
  - brand-new patient, no history, no notes
- `P-REV-GP`
  - general physician patient with several visits and at least one prior note
- `P-NOTES-NO-EXTRAS`
  - patient with notes but no specialty extras
- `P-LONG-TIMELINE`
  - patient with many visits, follow-ups, invoices, and timeline events
- `P-OPTO-FULL`
  - optometry patient with contact lens data, binocular vision data, low vision data, and multiple myopia readings
- `P-MYOPIA-EMPTY`
  - optometry patient with no myopia records
- `P-MYOPIA-ONE`
  - optometry patient with exactly one myopia record
- `P-MYOPIA-LONG`
  - optometry patient with many myopia records over time
- `P-INVOICE-READY`
  - patient in `done` state, not billed, valid email
- `P-CASESTUDY-GP`
  - general physician case-study-ready patient with enough timeline and notes
- `P-CASESTUDY-OPTO`
  - optometry case-study-ready patient with note history and myopia history
- `P-PDF-STRESS`
  - patient whose generated note/case study content is intentionally long

### Clinic fixtures
- `C-GP-CLEAN`
  - general physician clinic with sparse data
- `C-OPTO-CLEAN`
  - optometry clinic with sparse data
- `C-GP-POPULATED`
  - GP clinic with realistic patients, invoices, history
- `C-OPTO-POPULATED`
  - optometry clinic with realistic patients, myopia history, notes
- `C-LEGACY-NO-SPECIALTY`
  - old clinic missing `clinic_specialty`

### Document fixtures
- uploaded clinic document template PDF
- letterhead image template
- invoice-ready basket with service and medicine items
- case study long-content export sample
- note with drawing asset and attachment asset

## Environments and Execution Rules
- Run the full manual program in `staging` before release sign-off.
- Run P0 smoke in both `dev` and `staging`.
- Use a clean browser profile for auth, onboarding, and public follow-up tests.
- Repeat state-persistence cases in one browser with existing `localStorage` and once in a clean profile.
- Capture screenshots or screen recordings for UI regressions in these surfaces:
  - consultation
  - patient chart
  - myopia chart
  - case study export
  - settings document template preview

## Priority and Execution Labels
- `P0`: release blocker
- `P1`: core regression
- `P2`: extended or edge

- `manual only`: not yet stable or too visual
- `automate soon`: good first-wave E2E target
- `automate later`: valuable but more brittle or expensive

## Master Test Matrix
The matrix below is the execution index. Each row maps to a detailed suite later in this document.

| ID | Area | Route/Surface | Role | Specialty | Env | Device | Pri | Mode | Fixture / Setup | Expected Outcome | Side Effects |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M01 | Auth login | `/login` | admin | both | dev+staging | desktop | P0 | automate soon | `Admin GP Clinic`, `Admin Optometry Clinic` | valid login redirects to `/` or onboarding | session stored, shell bootstraps |
| M02 | Auth login | `/login` | staff | both | dev+staging | desktop | P0 | automate soon | `Staff GP Clinic`, `Staff Optometry Clinic` | valid login redirects to `/` | staff badge shown, restricted nav remains controlled |
| M03 | Auth errors | `/login` | all | n/a | dev+staging | desktop | P0 | automate soon | invalid credentials | inline auth error, no bad redirect | no session stored |
| M04 | Onboarding | `/onboarding/specialty` | admin | unset -> both | dev+staging | desktop | P0 | automate soon | `C-LEGACY-NO-SPECIALTY` or new registration | specialty saves and redirects to `/` | clinic settings updated |
| M05 | Onboarding redirect | `/onboarding/specialty` | admin | set | dev+staging | desktop | P1 | automate soon | any seeded clinic with specialty | page redirects away when specialty already set | pending flag cleared |
| M06 | Queue shell | `/` | admin | both | dev+staging | desktop | P0 | automate soon | populated clinic | queue loads with stable shell | patients fetched repeatedly |
| M07 | Add patient | `AddPatientModal` | admin+staff | both | dev+staging | desktop | P0 | automate soon | `P-NEW-GP` style data | new patient appears in queue | patient created or visit created |
| M08 | Appointment intake | `AddPatientModal` + appointments | admin+staff | both | dev+staging | desktop | P1 | automate later | new patient + scheduled time | appointment created instead of queue record | appointment visible in appointments panel |
| M09 | Queue refresh | `/` | admin+staff | both | dev+staging | desktop | P1 | manual only | populated queue | background refresh does not duplicate or reorder incorrectly | latest patient list synced |
| M10 | Consultation GP | `ConsultationDrawer` | admin | general_physician | dev+staging | desktop | P0 | automate soon | `P-NEW-GP`, `P-REV-GP` | generate/finalize/send/export works | note, audit, timeline updated |
| M11 | Consultation optometry | `ConsultationDrawer` | admin | optometry | dev+staging | desktop | P0 | automate soon | `P-OPTO-FULL` | optometry modules open/save and note includes structured context | note created with specialty data |
| M12 | Consultation draft recovery | `ConsultationDrawer` | admin | both | dev+staging | desktop | P1 | manual only | existing patient plus local draft | close/reopen/refresh restores draft safely | localStorage entry updated/cleared correctly |
| M13 | Follow-up from consult | `ConsultationDrawer` | admin | both | dev+staging | desktop | P1 | automate later | patient in consultation | follow-up can be scheduled | timeline follow_up event |
| M14 | Patient chart base | `PatientDetailsDrawer` | admin+staff | both | dev+staging | desktop | P0 | automate soon | `P-REV-GP`, `P-LONG-TIMELINE` | bio panel visible first, timeline loads, event detail works | patient/timeline fetches succeed |
| M15 | Patient chart edit | `PatientDetailsDrawer` | admin+staff | both | dev+staging | desktop | P1 | automate later | editable patient | save validation works and values persist | patient updated, audit event |
| M16 | Myopia chart empty | patient chart + myopia modal | admin+staff | optometry | dev+staging | desktop | P1 | automate soon | `P-MYOPIA-EMPTY` | empty graph state is clear | no crash, no stale event selected |
| M17 | Myopia chart single point | patient chart + myopia modal | admin+staff | optometry | dev+staging | desktop | P1 | automate soon | `P-MYOPIA-ONE` | one-point rendering is legible | chart model stable |
| M18 | Myopia chart long history | patient chart + myopia modal | admin+staff | optometry | dev+staging | desktop | P1 | automate later | `P-MYOPIA-LONG` | trend, overlay, projections render | new records update history |
| M19 | Patients page | `/patients` | admin+staff | both | dev+staging | desktop | P1 | automate later | mixed patient dataset | search/list/open chart works | route shell stable |
| M20 | History page | `/history` | admin+staff | both | dev+staging | desktop | P1 | automate later | multi-visit dataset | history loads, empty/filter states behave | route shell stable |
| M21 | Billing page | `/billing` | admin | both | dev+staging | desktop | P1 | automate soon | `P-INVOICE-READY`, catalog seeded | invoice draft/save/send/pdf works | invoice row, billing state, audit updated |
| M22 | Inventory page | `/inventory` | admin | both | dev+staging | desktop | P1 | automate later | services + medicines | add/edit stock/delete flows work | catalog updated, audit updated |
| M23 | Users page | `/users` | admin | both | dev+staging | desktop | P1 | automate later | staff account fixtures | add user, role update, delete work | user list updated |
| M24 | Account page | `/account` | admin+staff | both | dev+staging | desktop | P1 | manual only | any user | profile/account loads and saves correctly | user context stable |
| M25 | Audit page | `/audit` | admin | both | dev+staging | desktop | P1 | automate later | recent activity present | filter/detail drilldown works | events correspond to actions |
| M26 | Earnings page | `/earnings` | admin | both | dev+staging | desktop | P1 | manual only | invoiced clinic | summary metrics render | no staff access |
| M27 | Settings mega-suite | `SettingsDrawer` | admin+staff | both | dev+staging | desktop | P0 | automate soon for smoke | page opened from each route | drawer opens, tab switching stable, role restrictions correct | settings-dependent updates persist |
| M28 | Case Study base | `/case-study` | admin | general_physician | dev+staging | desktop | P0 | automate soon | `P-CASESTUDY-GP` | search/select/generate/save/export works | case study created/updated |
| M29 | Case Study optometry enrichment | `/case-study` | admin | optometry | dev+staging | desktop | P1 | automate later | `P-CASESTUDY-OPTO` | same flow plus additive source enrichment | no GP regression |
| M30 | Case Study access | `/case-study` | staff | both | dev+staging | desktop | P1 | automate soon | staff persona | access denied UI, no editor exposure | no data load |
| M31 | Follow-up public valid | `/follow-up?token=...` | anonymous | n/a | dev+staging | desktop+mobile | P0 | automate soon | `Public Follow-up Patient` | token loads, slot can be confirmed | follow-up updated |
| M32 | Follow-up public invalid | `/follow-up?token=bad` | anonymous | n/a | dev+staging | desktop+mobile | P1 | automate soon | invalid/expired token | safe error state, no shell leakage | nothing changed |
| M33 | Superuser access allowed | `/superuser` | allowlisted user | n/a | dev+staging | desktop | P1 | manual only | `Superuser` | org dashboard loads | org and error queries succeed |
| M34 | Superuser access denied | `/superuser` | non-allowlisted | n/a | dev+staging | desktop | P1 | manual only | normal admin or staff | denied/forbidden behavior | no privileged data exposed |
| M35 | Mobile smoke | key routes and drawers | relevant roles | both | dev+staging | mobile viewport | P0 | automate later | all P0 personas | layout remains usable | no clipped or trapped UI |

## Cross-Cutting Dimensions
Every applicable test above must exercise the following dimensions deliberately:

### Role coverage
- admin happy path
- staff restricted path
- superuser hidden route path
- anonymous public path

### Specialty coverage
- `general_physician`: base flow must remain unchanged
- `optometry`: additive features only

### Data states
- empty state
- minimal valid state
- realistic populated state
- legacy/stale data
- local draft/local ordering state already present

### Error-path coverage
- required field validation
- invalid email/phone/date inputs
- backend timeout/fetch failure
- generate/send/export failure
- stale selected patient or closed modal state
- missing specialty
- invalid public token

### State/persistence coverage
- refresh page mid-flow
- close and reopen drawer/modal
- navigate away and return
- repeat generate / repeat save / repeat export
- browser back/forward where meaningful

## P0 Smoke Suite
Run this in `dev` on every substantial UI change and in `staging` before release.

### P0-1 Login smoke
Preconditions
- clean browser profile
- valid `Admin GP Clinic`

Steps
1. Open `/login`.
2. Confirm login page renders without authenticated shell content.
3. Log in with valid admin credentials.
4. Confirm redirect lands on `/` or `/onboarding/specialty` if specialty is still unset.
5. Refresh the browser.

Expected UI
- no protected page flashes before auth settles
- login errors area is empty on success
- shell loads with header and nav after auth

Expected backend-visible outcome
- `auth/session bootstrap` succeeds

Persistence checks
- refresh keeps the user in-session

Negative checks
- repeat with invalid password and verify inline error, no redirect, no session bootstrap

### P0-2 Specialty onboarding smoke
Preconditions
- new registration or `C-LEGACY-NO-SPECIALTY`

Steps
1. Reach `/onboarding/specialty`.
2. Verify both specialty cards render.
3. Save `optometry`.
4. Confirm redirect to `/`.
5. Revisit `/onboarding/specialty` directly.
6. Repeat with a fresh clinic and save `general_physician`.

Expected UI
- selected card remains visually selected until submit finishes
- no loop back into onboarding once specialty saved

Expected backend-visible outcome
- `clinic settings update` persists `clinic_specialty`

Negative checks
- simulate slow load; verify save is blocked until settings available

### P0-3 Queue load and add patient smoke
Preconditions
- logged in as admin or staff
- clinic with existing queue data

Steps
1. Open `/`.
2. Confirm queue columns render.
3. Open `AddPatientModal`.
4. Create one queue patient using `P-NEW-GP`.
5. Create one appointment-path record with scheduled time.
6. Close and reopen the modal.

Expected UI
- modal validation works
- newly added queue patient appears without duplicate rows
- appointment path does not masquerade as a queue row

Expected backend-visible outcome
- `patient create` or `appointment create` succeeds

Negative checks
- required field omissions
- invalid phone/email if surfaced

### P0-4 Consultation smoke
Preconditions
- admin user
- one patient in waiting queue

Steps
1. Move patient into consultation if required.
2. Open `ConsultationDrawer`.
3. Enter symptoms, diagnosis, medications, notes.
4. Generate note.
5. Finalize/complete consult path.

Expected UI
- no crash during note generation
- generated note content appears
- drawer can be closed cleanly after completion

Expected backend-visible outcome
- `note generation`
- `note finalize`
- patient status/timeline update

Negative checks
- staff attempt to start consultation or generate note should be blocked by UI and backed by server 403

### P0-5 Optometry module smoke
Preconditions
- `Admin Optometry Clinic`
- `P-OPTO-FULL` or fresh optometry patient

Steps
1. Open consultation.
2. Verify specialty pills/modules are visible.
3. Open Contact Lens, enter minimal valid data, save.
4. Open Binocular Vision, save.
5. Open Low Vision, save.
6. Open Myopia Management, save a measurement if allowed.
7. Generate note.

Expected UI
- all modal shells open and close consistently
- saved modules show “has data” states or summaries

Expected backend-visible outcome
- note payload carries optometry structured sections

### P0-6 Patient chart smoke
Preconditions
- patient exists in queue/history

Steps
1. Open `PatientDetailsDrawer` from queue or page entry point.
2. Confirm bio panel is visible immediately.
3. Confirm timeline loads.
4. Click one event and inspect details.
5. Close and reopen.

Expected UI
- chart opens into a clear bio-first view
- timeline selection works without blank detail panes

Expected backend-visible outcome
- `patient detail/timeline read`

### P0-7 Case Study smoke
Preconditions
- admin user
- `P-CASESTUDY-GP` and `P-CASESTUDY-OPTO`

Steps
1. Open `/case-study`.
2. Search and select a patient.
3. Set title and brief instructions.
4. Generate case study.
5. Save draft.
6. Export PDF.

Expected UI
- patient search dropdown closes after selection
- content appears in editor
- export succeeds only after save

Expected backend-visible outcome
- `case study source`
- `case study generate`
- `case study save`
- `case study pdf`

### P0-8 Settings drawer smoke
Preconditions
- logged in user on `/`

Steps
1. Open `SettingsDrawer`.
2. Switch between at least three tabs: Clinic, Appointments, Generate Letter.
3. Close and reopen.

Expected UI
- drawer opens from header menu
- tab switching is stable
- reopen state is predictable and not corrupted

### P0-9 Mobile smoke
Viewport
- narrow phone width

Routes and surfaces
- `/login`
- `/`
- `AddPatientModal`
- `ConsultationDrawer`
- `PatientDetailsDrawer`
- `/case-study`
- `SettingsDrawer`
- `/follow-up`

Expected UI
- no clipped primary CTA
- no impossible scroll traps
- drawers and modals remain dismissible

## Core Regression Suite

### A. Authentication and app-shell suite
Cover:
- valid admin login
- valid staff login
- invalid login
- refresh bootstrap
- logout
- expired session redirect
- public-path behavior for `/login` and `/follow-up`
- header/nav consistency across pages

Additional checks
- direct-hit protected route while logged out should redirect to `/login`
- after logout, browser back should not expose authenticated data
- when session expires, redirect should include `reason=session-expired`
- shell should not render inaccessible content during auth bootstrap

### B. Specialty onboarding and clinic settings suite
Use fixtures:
- `C-LEGACY-NO-SPECIALTY`
- `Admin GP Clinic`
- `Admin Optometry Clinic`

Steps
1. New clinic flow: register from `/login`, confirm specialty onboarding redirect.
2. Save `optometry`, reload `/`, confirm optometry surfaces later appear.
3. Existing clinic flow: open `SettingsDrawer > Clinic`, change specialty from GP to optometry.
4. Refresh app and verify specialty-specific UI appears only where intended.
5. Change back to GP and verify optometry modules disappear from consultation and chart.

Expected outcomes
- both specialties save cleanly
- onboarding does not loop
- old clinics without specialty are routed into onboarding once, not forever

### C. Queue and patient intake suite
Use fixtures:
- `P-NEW-GP`
- `P-REV-GP`

Coverage
- empty queue state
- populated queue state
- background refresh stability
- add new patient to queue
- create appointment from intake modal
- create revisit for existing patient if surfaced
- duplicate/partial/invalid fields
- selection into details drawer and consultation

Persistence checks
- refresh while modal closed
- refresh while queue has reordered local state
- verify no duplicate or stale rows after polling

### D. Consultation suite
This is the deepest workflow suite.

#### D1. Base consultation flow for general physician
Fixture
- `Admin GP Clinic`
- `P-REV-GP`

Steps
1. Open consultation from queue.
2. Enter vitals, symptoms, diagnosis, meds, notes.
3. Add test scores if needed.
4. Generate note.
5. If available, regenerate/update and generate again.
6. Generate PDF.
7. Send to patient email.
8. Create follow-up.
9. Complete consultation.

Expected outcomes
- generated note is coherent and stable
- note version/final status updates correctly
- send requires valid email
- PDF downloads without failure
- timeline shows consultation and follow-up events

#### D2. Optometry consultation flow
Fixture
- `Admin Optometry Clinic`
- `P-OPTO-FULL`

Steps
1. Open consultation.
2. Verify specialty pills are visible only in optometry clinic.
3. Exercise each modal:
   - Contact Lens
   - Binocular Vision
   - Low Vision
   - Myopia Management
4. Save each modal with realistic data.
5. Reopen each modal and confirm values persist within the draft/session.
6. Generate note.

Expected outcomes
- no modal opens blank after prior save unless intentionally reset
- note content reflects the structured specialty information appropriately
- general physician clinic must not show these modules

#### D3. Draft persistence and stale local state
Fixture
- any patient with generated and non-generated drafts

Steps
1. Open consultation and enter partial content.
2. Close drawer without completing.
3. Reopen same patient.
4. Refresh browser and reopen.
5. Generate note, then close and reopen.
6. Complete consultation and verify cleanup behavior.

Expected outcomes
- local draft recovers safely
- stale cache does not crash the drawer
- cleared/completed states do not leak into the next consultation unexpectedly

#### D4. Negative paths
- send note without recipient email
- oversize or unsupported attachment type
- repeated generate clicks while request in-flight
- PDF generation failure
- backend timeout

### E. Patient chart and timeline suite

#### E1. Base chart behavior
Fixture
- `P-LONG-TIMELINE`

Steps
1. Open chart from queue.
2. Open chart from patients page.
3. Confirm bio data panel is first and always visible.
4. Confirm timeline groups by date and selected event details render.
5. Save profile edits if allowed.
6. Reopen chart.

Expected outcomes
- chart never defaults into an ambiguous event-first state
- selected event clears or resets safely on reopen

#### E2. Optometry chart behavior
Fixtures
- `P-MYOPIA-EMPTY`
- `P-MYOPIA-ONE`
- `P-MYOPIA-LONG`

Steps
1. In optometry clinic, open chart and verify Myopia Management entry point.
2. Open myopia modal with empty dataset.
3. Repeat with one-point dataset.
4. Repeat with long-history dataset.
5. Add historical reading through `HistoricalMyopiaModal`.
6. Verify chart and timeline update after save.

Expected outcomes
- empty, one-point, and many-point states are all visually sound
- trend/projection/overlay lines do not overlap illegibly
- non-optometry clinics must not expose myopia UI

### F. Page-level suites

#### F1. `/patients`
- page load
- empty state and populated state
- search/filter if surfaced
- open patient chart
- navigation away and back

#### F2. `/history`
- page load
- verify historical records render and are navigable
- empty state and dense dataset
- drill into patient/event where available

#### F3. `/billing`
Fixture
- `P-INVOICE-READY`

Checks
- staff redirect to `/`
- admin page load
- patient selector
- invoice item composition from services and medicines
- custom item path
- payment status `paid`, `unpaid`, `partial`
- amount paid validation
- invoice save
- invoice PDF
- invoice send
- invoice history filters
- completion actor and sent state display

#### F4. `/inventory`
- staff redirect to `/`
- services list
- medicines list
- add service
- add medicine with tracked inventory
- low stock threshold behavior
- stock adjustment positive and negative
- delete item

#### F5. `/users`
- staff redirect to `/`
- admin load users
- add staff account
- validation on short password / missing identifier
- role change admin<->staff
- delete user

#### F6. `/account`
- admin and staff both load
- verify identity, role badge, and editable fields if present
- save and refresh persistence

#### F7. `/audit`
- staff redirect to `/`
- admin load
- action filter
- entity filter
- open event detail
- verify event summaries match recent performed actions

#### F8. `/earnings`
- staff redirect to `/`
- admin load
- totals/summary render
- empty state and populated state
- refresh behavior

### G. Settings drawer mega-suite
Open the drawer from:
- `/`
- `/patients`
- `/history`
- `/billing`
- `/inventory`
- `/users`
- `/account`
- `/audit`
- `/earnings`
- `/case-study`

Verify these menu/tabs:
- Queue
- Patients
- Case Study
- Appointments
- Billing
- History
- Inventory
- Users
- Account
- Audit
- Clinic
- Generate Letter
- About
- Contact Us
- Earnings for admin only

Panel coverage

#### G1. Clinic panel
- clinic name, address, phone
- specialty selector
- appointment hours
- doctor/sender fields
- document template upload/preview
- header/footer fields
- note/letter/invoice template toggles
- margin controls

Expected outcomes
- saved values survive refresh
- specialty change propagates to rest of app as intended
- uploaded template preview remains stable

#### G2. Appointments panel
- list appointments
- check-in to existing patient
- check-in force new patient
- update appointment status/time
- verify queue/timeline side effects

#### G3. Billing panel
- open from settings drawer
- select billable patient
- create invoice
- PDF
- send

#### G4. Generate Letter panel
- generate letter text
- preview PDF
- send letter
- validate missing recipient and send failures

#### G5. Inventory panel
- same functional checks as `/inventory`, but verify within drawer context

#### G6. Users panel
- same functional checks as `/users`, but verify within drawer context
- ensure staff sees restricted controls disabled or hidden

#### G7. Audit/exports surfaces
- export patients CSV
- export visits CSV
- export invoices CSV
- verify download success and filenames

State/reset checks
- close and reopen drawer from a different route
- verify tab state does not leak in a broken way
- verify loading flags and errors do not persist forever after success

### H. Case Study suite
Treat as first-class.

#### H1. Access control
- admin loads full feature
- staff sees admin-only restriction and no editable generator surface

#### H2. Core flow
Fixtures
- `P-CASESTUDY-GP`
- `P-CASESTUDY-OPTO`

Steps
1. Search patient.
2. Select patient and confirm dropdown closes.
3. Toggle anonymized on/off.
4. Choose each format/template:
   - `conference_presentation`
   - `teaching_rounds`
   - `hospital_case_discussion`
5. Enter title and author instructions.
6. Generate.
7. Edit generated content manually.
8. Save draft.
9. Save final.
10. Reload page and reopen saved study.
11. Copy to clipboard.
12. Export PDF.

Expected outcomes
- GP and optometry both work
- optometry only adds richer source context; it does not gate the feature
- export requires saved case study id
- copy works or shows explicit error

#### H3. PDF output validation
Use `P-PDF-STRESS`.

Checks
- white A4 output
- no clinic letterhead
- no overlapping header/content
- header says `Case Study`
- long content paginates cleanly

#### H4. Negative paths
- generate without patient
- save without title
- save without content
- export before save
- timeout/loading behavior

### I. Public follow-up flow
Fixtures
- valid token
- invalid token
- expired token

Steps
1. Open valid `/follow-up?token=...`.
2. Confirm there is no logged-in shell.
3. Verify clinic, patient, current time, and notes render.
4. Pick suggested slot.
5. Pick manual date-time.
6. Submit.
7. Refresh and confirm updated scheduled time.

Expected outcomes
- success message appears
- backend follow-up is updated
- invalid token shows safe error and nothing else
- mobile layout remains usable

### J. Superuser/admin-special suite
This route is special because backend access depends on allowlisted identifier.

#### J1. Allowed path
- open `/superuser` with `Superuser`
- verify tabs `dashboard`, `orgs`, `errors`
- verify org list loads
- open org detail
- refresh dashboard
- if safe in test env, exercise user delete/org delete only in isolated org fixture

#### J2. Denied path
- open `/superuser` as non-allowlisted admin and as staff
- verify backend denial and no privileged data exposure

## Role and Access-Control Regression
This suite should be run after any auth, shell, or nav change.

### Admin
- full access to all routes above except public-only behavior

### Staff
- allowed:
  - `/`
  - `/patients`
  - `/history`
  - `/account`
- restricted or redirected:
  - `/billing`
  - `/inventory`
  - `/users`
  - `/audit`
  - `/earnings`
  - `/case-study`
- backend must also reject restricted API calls even if UI is bypassed

### Superuser
- only allowlisted identifiers can use superuser endpoints

### Anonymous
- only `/login` and `/follow-up` should be usable

## Responsive / Mobile Smoke
Minimum manual coverage on narrow viewport:

### R1 `/login`
- form fields, error state, submit CTA, no clipped two-column breakage

### R2 `/`
- queue columns/cards usable
- menu button reachable
- add patient modal fits and scrolls

### R3 `ConsultationDrawer`
- open/close
- primary fields editable
- specialty modals dismissible

### R4 `PatientDetailsDrawer`
- timeline and bio sections readable
- close affordance always reachable

### R5 `/case-study`
- composer area above the fold
- patient search usable
- generate/save/export controls reachable

### R6 `/follow-up`
- slot chips wrap correctly
- date-time picker usable
- success/error messages readable

## Manual Execution Templates
Use this result template for every manual case:

- Test ID:
- Environment:
- Browser / viewport:
- Role:
- Specialty:
- Fixture:
- Result: pass / fail / blocked
- Evidence:
- Notes:
- Backend-visible confirmation:

## Automation Roadmap
The repo does not currently show a mature UI E2E harness wired for these workflows. Do not pretend this should all be automated immediately. Build in phases.

### Phase 1: release-blocking smoke
Automate first:
- login success/failure
- specialty onboarding selection and redirect
- queue load
- add patient to queue
- open consultation
- generate core note
- optometry module open/save smoke
- patient chart open
- myopia modal open with chart visible
- case study generate/save/export smoke
- settings drawer open and tab switch smoke
- public follow-up token load and confirm

These are ideal browser E2E targets because:
- they are high-frequency release blockers
- UI structure is stable enough
- assertions are mostly deterministic

### Phase 2: high-value regressions
Automate next:
- specialty gating checks between GP and optometry
- patient chart myopia backfill flow
- case study search/select/anonymize/generate
- billing invoice create/export/send smoke
- role access restrictions and redirect checks
- staff denial on admin pages
- appointment check-in via settings panel

### Phase 3: brittle but valuable
Automate later:
- myopia hover interactions/tooltips
- PDF snapshot or content smoke checks
- long-form case study editor and regenerate flows
- attachment-heavy consultation flows
- mobile viewport snapshots for major pages
- superuser dashboards if test seeding becomes reliable

## What Should Stay Manual
- nuanced readability of generated PDFs
- visual alignment of document templates and preview inset behavior
- long-form generated content quality
- chart readability and hover affordances
- destructive superuser actions in shared environments

## What Is Better Covered Below UI E2E
- pure chart math and myopia projection helpers
- note formatting/parsing helpers
- case study specialty enrichment
- PDF builder edge cases
- permission-contract tests

These already have some coverage patterns in the repo and should continue to expand at unit/integration level.

## Recommended Automation Structure
- one smoke spec per route family
- one shared auth helper for admin, staff, optometry admin
- seed helpers for:
  - GP clinic
  - optometry clinic
  - case-study patient
  - invoice-ready patient
  - follow-up token
- stabilize selectors on:
  - primary nav
  - drawer open/close
  - consultation generate/finalize actions
  - case study patient search and export
  - settings tabs

## Release Gate Recommendation
Before release approval:
- all `P0` tests pass in `staging`
- no unresolved auth, specialty gating, consultation, patient chart, or case study failures
- one mobile smoke pass completed
- one staff access-control pass completed
- one optometry regression pass completed if any optometry-related code changed

## Traceability Notes
This plan maps directly to current implementation in:
- `web/components/clinic-shell-provider.tsx`
- `web/components/consultation-drawer.tsx`
- `web/components/patient-details-drawer.tsx`
- `web/components/settings-drawer.tsx`
- `web/app/case-study/page.tsx`
- `web/app/follow-up/page.tsx`
- `web/app/*/page.tsx` route pages
- `tests/test_permissions.py`
- `tests/test_followups.py`
- `tests/test_case_study_specialty.py`
- `tests/test_settings.py`
- `tests/test_superuser.py`

Update this document whenever route access, shared drawer behavior, specialty gating, or document/export flows materially change.
