# Graph Report - .  (2026-05-22)

## Corpus Check
- 177 files · ~190,686 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1201 nodes · 2503 edges · 80 communities detected
- Extraction: 61% EXTRACTED · 39% INFERRED · 0% AMBIGUOUS · INFERRED: 970 edges (avg confidence: 0.74)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Backend Errors Settings|Backend Errors Settings]]
- [[_COMMUNITY_Appointments Audit Workflows|Appointments Audit Workflows]]
- [[_COMMUNITY_Repository Test Doubles|Repository Test Doubles]]
- [[_COMMUNITY_Auth Sessions Signatures|Auth Sessions Signatures]]
- [[_COMMUNITY_Backend Regression Tests|Backend Regression Tests]]
- [[_COMMUNITY_Consultation Specialty UI|Consultation Specialty UI]]
- [[_COMMUNITY_Documents PDF Export|Documents PDF Export]]
- [[_COMMUNITY_Billing Specialty Models|Billing Specialty Models]]
- [[_COMMUNITY_AI Generation Usage|AI Generation Usage]]
- [[_COMMUNITY_Queue Billing UI|Queue Billing UI]]
- [[_COMMUNITY_Pilot QA Failures|Pilot QA Failures]]
- [[_COMMUNITY_Superuser Audit Admin|Superuser Audit Admin]]
- [[_COMMUNITY_CSV Export Flows|CSV Export Flows]]
- [[_COMMUNITY_Audit Event Recording|Audit Event Recording]]
- [[_COMMUNITY_Registration Admin UI|Registration Admin UI]]
- [[_COMMUNITY_API Client Session|API Client Session]]
- [[_COMMUNITY_Follow-Up Scheduling|Follow-Up Scheduling]]
- [[_COMMUNITY_Patient Timeline Myopia|Patient Timeline Myopia]]
- [[_COMMUNITY_E2E Mock Fixtures|E2E Mock Fixtures]]
- [[_COMMUNITY_PDF Canvas Drawing|PDF Canvas Drawing]]
- [[_COMMUNITY_Frontend Module Tests|Frontend Module Tests]]
- [[_COMMUNITY_Setup Step Modal|Setup Step Modal]]
- [[_COMMUNITY_Patient Intake Modal|Patient Intake Modal]]
- [[_COMMUNITY_Audit History Page|Audit History Page]]
- [[_COMMUNITY_Account Profile Page|Account Profile Page]]
- [[_COMMUNITY_Clinic Shell State|Clinic Shell State]]
- [[_COMMUNITY_Next Segment Stub|Next Segment Stub]]
- [[_COMMUNITY_Architecture Tests|Architecture Tests]]
- [[_COMMUNITY_CSP Dev Origins|CSP Dev Origins]]
- [[_COMMUNITY_Catalog Inventory UI|Catalog Inventory UI]]
- [[_COMMUNITY_Settings Drawer Preview|Settings Drawer Preview]]
- [[_COMMUNITY_Settings Users Panel|Settings Users Panel]]
- [[_COMMUNITY_Patient Event Details|Patient Event Details]]
- [[_COMMUNITY_Setup Flow Routing|Setup Flow Routing]]
- [[_COMMUNITY_Myopia Chart Helpers|Myopia Chart Helpers]]
- [[_COMMUNITY_Low Vision Modal|Low Vision Modal]]
- [[_COMMUNITY_Myopia Modal Values|Myopia Modal Values]]
- [[_COMMUNITY_Specialty Module Registry|Specialty Module Registry]]
- [[_COMMUNITY_Auth Browser Storage|Auth Browser Storage]]
- [[_COMMUNITY_Root Layout|Root Layout]]
- [[_COMMUNITY_Add User Page|Add User Page]]
- [[_COMMUNITY_Patient Card|Patient Card]]
- [[_COMMUNITY_Letters Settings Panel|Letters Settings Panel]]
- [[_COMMUNITY_Myopia Modal|Myopia Modal]]
- [[_COMMUNITY_Optometry Modal Shell|Optometry Modal Shell]]
- [[_COMMUNITY_Health Endpoint|Health Endpoint]]
- [[_COMMUNITY_Next Type Declarations|Next Type Declarations]]
- [[_COMMUNITY_Clinic Visual Theme|Clinic Visual Theme]]
- [[_COMMUNITY_Playwright Config|Playwright Config]]
- [[_COMMUNITY_PostCSS Config|PostCSS Config]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Lazy Settings Drawer|Lazy Settings Drawer]]
- [[_COMMUNITY_Inventory Panel Split|Inventory Panel Split]]
- [[_COMMUNITY_App Header|App Header]]
- [[_COMMUNITY_Patient Column|Patient Column]]
- [[_COMMUNITY_Billing Settings Panel|Billing Settings Panel]]
- [[_COMMUNITY_Patient Timeline Panel|Patient Timeline Panel]]
- [[_COMMUNITY_Patient Bio Panel|Patient Bio Panel]]
- [[_COMMUNITY_Contact Lens Modal|Contact Lens Modal]]
- [[_COMMUNITY_Myopia Progression Chart|Myopia Progression Chart]]
- [[_COMMUNITY_Clinic Specialty Types|Clinic Specialty Types]]
- [[_COMMUNITY_Myopia Reference Data|Myopia Reference Data]]
- [[_COMMUNITY_Recent Patients Store|Recent Patients Store]]
- [[_COMMUNITY_Shared Types|Shared Types]]
- [[_COMMUNITY_Follow-Up E2E Spec|Follow-Up E2E Spec]]
- [[_COMMUNITY_Consultation E2E Spec|Consultation E2E Spec]]
- [[_COMMUNITY_Login E2E Spec|Login E2E Spec]]
- [[_COMMUNITY_Patient Chart E2E Spec|Patient Chart E2E Spec]]
- [[_COMMUNITY_Queue E2E Spec|Queue E2E Spec]]
- [[_COMMUNITY_Onboarding E2E Spec|Onboarding E2E Spec]]
- [[_COMMUNITY_Case Study E2E Spec|Case Study E2E Spec]]
- [[_COMMUNITY_Pytest Fixtures|Pytest Fixtures]]
- [[_COMMUNITY_Backend Package Init|Backend Package Init]]
- [[_COMMUNITY_Backend Schemas|Backend Schemas]]
- [[_COMMUNITY_Routes Package Init|Routes Package Init]]
- [[_COMMUNITY_Repositories Package Init|Repositories Package Init]]
- [[_COMMUNITY_Workflows Package Init|Workflows Package Init]]
- [[_COMMUNITY_Common Backend Types|Common Backend Types]]
- [[_COMMUNITY_Services Package Init|Services Package Init]]
- [[_COMMUNITY_Tests Package Init|Tests Package Init]]

## God Nodes (most connected - your core abstractions)
1. `FakeRepo` - 81 edges
2. `register()` - 62 edges
3. `auth_headers()` - 59 edges
4. `internal_server_error()` - 42 edges
5. `bad_request_error()` - 37 edges
6. `_now()` - 28 edges
7. `build_note_pdf()` - 28 edges
8. `AuthSettingsRepositoryMixin` - 27 edges
9. `PatientFlowRepositoryMixin` - 24 edges
10. `build_invoice_pdf()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `build_csv_response()` --calls--> `format_export_datetime()`  [INFERRED]
  backend/app/exports.py → /Users/dhairyalalwani/PycharmProjects/mr/backend/app/formatting.py
- `Post-Deploy Smoke Check` --semantically_similar_to--> `P0 Smoke Suite`  [INFERRED] [semantically similar]
  PILOT_RUNBOOK.md → QA_REGRESSION_PLAN.md
- `Daily Pilot Checks` --semantically_similar_to--> `Release Gate Recommendation`  [INFERRED] [semantically similar]
  PILOT_RUNBOOK.md → QA_REGRESSION_PLAN.md
- `handleSubmit()` --calls--> `register()`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/web/app/follow-up/page.tsx → tests/test_app.py
- `test_public_follow_up_booking_reschedules_and_creates_appointment()` --calls--> `update()`  [INFERRED]
  tests/test_app.py → web/components/optometry/binocular-vision-modal.tsx

## Hyperedges (group relationships)
- **Clinic EMR Runtime Architecture** — readme_nextjs_frontend, readme_fastapi_backend, readme_supabase_postgresql, readme_anthropic_claude [EXTRACTED 1.00]
- **Pilot Operational Release Controls** — pilot_before_go_live, pilot_post_deploy_smoke_check, pilot_daily_checks, pilot_rollback, qa_release_gate_recommendation [INFERRED 0.82]
- **Playwright Strict Locator Failures** — consultation_error_strict_start_locator, consultation_error_queue_card_button, patient_chart_error_visit_locator, patient_chart_error_duplicate_visit_buttons [EXTRACTED 1.00]

## Communities

### Community 0 - "Backend Errors Settings"
Cohesion: 0.03
Nodes (111): AppError, bad_request_error(), ConflictError, ForbiddenBusinessActionError, IntegrationFailureError, internal_server_error(), InvalidStateError, not_found_error() (+103 more)

### Community 1 - "Appointments Audit Workflows"
Cohesion: 0.03
Nodes (69): AIUsageRepositoryMixin, check_in_appointment_workflow(), create_appointment_workflow(), update_appointment_workflow(), check_in_appointment(), create_appointment(), list_appointments(), preview_check_in_appointment() (+61 more)

### Community 2 - "Repository Test Doubles"
Cohesion: 0.04
Nodes (6): update(), client(), FakeRepo, _normalize_phone(), _now(), ValueError

### Community 3 - "Auth Sessions Signatures"
Cohesion: 0.05
Nodes (57): _b64decode(), _b64encode(), _build_access_token_payload(), clear_session(), create_access_token(), decode_access_token(), delete_my_signature(), download_my_signature() (+49 more)

### Community 4 - "Backend Regression Tests"
Cohesion: 0.06
Nodes (65): auth_headers(), register(), test_case_study_generation_storage_and_pdf(), test_case_study_source_is_generic_for_non_optometry_clinics(), test_generate_parent_handout_returns_pediatric_content(), test_myopia_measurements_create_history_and_timeline(), test_pediatric_growth_records_create_history_and_timeline(), test_public_follow_up_booking_rate_limits_context_requests() (+57 more)

### Community 5 - "Consultation Specialty UI"
Cohesion: 0.04
Nodes (36): Boolean(), buildBinocularVisionSummary(), buildLowVisionSummary(), buildMyopiaManagementSummary(), createEmptyBinocularVision(), createEmptyContactLens(), createEmptyLowVision(), createEmptyMyopiaManagement() (+28 more)

### Community 6 - "Documents PDF Export"
Cohesion: 0.09
Nodes (54): downloadBlob(), handleExportPdf(), handleGenerate(), handleSelectPatient(), resetDraft(), _append_pdf_bytes(), _apply_pdf_template(), build_case_study_pdf() (+46 more)

### Community 7 - "Billing Specialty Models"
Cohesion: 0.12
Nodes (61): BaseModel, CatalogItemBase, CatalogItemCreate, CatalogStockUpdate, InvoiceCreate, InvoiceItemInput, InvoiceItemOut, SendInvoiceRequest (+53 more)

### Community 8 - "AI Generation Usage"
Cohesion: 0.05
Nodes (43): anthropic_usage_from_response(), record_anthropic_usage(), AIUsageRepositoryMixin, build_fallback_case_study(), build_fallback_letter(), build_fallback_note(), _extract_pipe_table_blocks(), generate_case_study_document() (+35 more)

### Community 9 - "Queue Billing UI"
Cohesion: 0.06
Nodes (20): async(), buildAutoDraftInvoiceItems(), createEmptyQueueOrder(), createId(), extractMedicineSuggestions(), extractStructuredPrescriptionItems(), handleAdvancePatient(), handleCreateBill() (+12 more)

### Community 10 - "Pilot QA Failures"
Cohesion: 0.08
Nodes (40): Queue Card Button Accessible Name Collision, Consultation Smoke Strict Start Locator Failure, Duplicate Visit Buttons Across Timeline And Visit History, Patient Chart Strict Visit Locator Failure, Before Go-Live Checklist, Pilot Breakage Triage, Daily Pilot Checks, Post-Deploy Smoke Check (+32 more)

### Community 11 - "Superuser Audit Admin"
Cohesion: 0.15
Nodes (14): ExportRow, PlatformErrorOut, SuperuserOrgDetailOut, SuperuserOrgSummaryOut, SuperuserOrgUserOut, SuperuserUsageSummaryOut, list_audit_events(), AuditEventOut (+6 more)

### Community 12 - "CSV Export Flows"
Cohesion: 0.15
Nodes (18): build_csv_response(), build_history_visit_rows(), export_invoices_csv(), export_patients_csv(), export_visits_csv(), filter_rows_by_created_at(), get_export_range_start(), get_patient_visits() (+10 more)

### Community 13 - "Audit Event Recording"
Cohesion: 0.17
Nodes (19): get_actor_name(), record_appointment_checked_in(), record_appointment_created(), record_appointment_updated(), record_catalog_item_created(), record_catalog_item_deleted(), record_catalog_stock_adjusted(), record_follow_up_created() (+11 more)

### Community 14 - "Registration Admin UI"
Cohesion: 0.15
Nodes (9): cn(), formatDateTime(), formatNumber(), handleContinueRegistration(), handleModeChange(), handleSubmit(), loadContext(), resetRegisterFields() (+1 more)

### Community 15 - "API Client Session"
Cohesion: 0.27
Nodes (14): buildRequestHeaders(), canRetrySafely(), createTimeoutSignal(), delay(), getActiveToken(), getRequestMethod(), isSessionErrorMessage(), performFetch() (+6 more)

### Community 16 - "Follow-Up Scheduling"
Cohesion: 0.13
Nodes (2): handleCheckIn(), handleStartCheckIn()

### Community 17 - "Patient Timeline Myopia"
Cohesion: 0.15
Nodes (2): getPhoneDigits(), handleSave()

### Community 18 - "E2E Mock Fixtures"
Cohesion: 0.26
Nodes (10): buildCaseStudySource(), buildClinicSettings(), buildPatient(), buildUser(), fulfillJson(), jsonHeaders(), mockClinicBootstrap(), mockLoginFlow() (+2 more)

### Community 19 - "PDF Canvas Drawing"
Cohesion: 0.15
Nodes (1): _RecordingCanvas

### Community 20 - "Frontend Module Tests"
Cohesion: 0.21
Nodes (4): compileModule(), ensureTsPath(), importWebModule(), resolveSourceSpecifier()

### Community 21 - "Setup Step Modal"
Cohesion: 0.2
Nodes (2): buildSettingsPayload(), handleSubmit()

### Community 22 - "Patient Intake Modal"
Cohesion: 0.36
Nodes (8): getPhoneDigits(), handleClose(), handleSearchExistingPatient(), handleSubmit(), resetForm(), submitPatient(), toCentimeters(), toFahrenheit()

### Community 23 - "Audit History Page"
Cohesion: 0.32
Nodes (3): getAuditSummary(), getPatientName(), inferPatientNameFromSummary()

### Community 24 - "Account Profile Page"
Cohesion: 0.25
Nodes (0):

### Community 25 - "Clinic Shell State"
Cohesion: 0.33
Nodes (2): useClinicShell(), useClinicShellPage()

### Community 26 - "Next Segment Stub"
Cohesion: 0.33
Nodes (0):

### Community 27 - "Architecture Tests"
Cohesion: 0.4
Nodes (0):

### Community 28 - "CSP Dev Origins"
Cohesion: 0.67
Nodes (2): buildDevConnectSources(), unique()

### Community 29 - "Catalog Inventory UI"
Cohesion: 0.5
Nodes (0):

### Community 30 - "Settings Drawer Preview"
Cohesion: 0.67
Nodes (2): normalizePreviewMargin(), previewInsetStyles()

### Community 31 - "Settings Users Panel"
Cohesion: 0.5
Nodes (0):

### Community 32 - "Patient Event Details"
Cohesion: 0.5
Nodes (0):

### Community 33 - "Setup Flow Routing"
Cohesion: 0.5
Nodes (0):

### Community 34 - "Myopia Chart Helpers"
Cohesion: 0.83
Nodes (3): buildModeledPoints(), buildMyopiaChartModel(), buildPath()

### Community 35 - "Low Vision Modal"
Cohesion: 0.67
Nodes (0):

### Community 36 - "Myopia Modal Values"
Cohesion: 0.67
Nodes (0):

### Community 37 - "Specialty Module Registry"
Cohesion: 1.0
Nodes (2): getSpecialtyModules(), specialtyHasModule()

### Community 38 - "Auth Browser Storage"
Cohesion: 1.0
Nodes (2): getSessionStorage(), isBrowser()

### Community 39 - "Root Layout"
Cohesion: 1.0
Nodes (0):

### Community 40 - "Add User Page"
Cohesion: 1.0
Nodes (0):

### Community 41 - "Patient Card"
Cohesion: 1.0
Nodes (0):

### Community 42 - "Letters Settings Panel"
Cohesion: 1.0
Nodes (0):

### Community 43 - "Myopia Modal"
Cohesion: 1.0
Nodes (0):

### Community 44 - "Optometry Modal Shell"
Cohesion: 1.0
Nodes (0):

### Community 45 - "Health Endpoint"
Cohesion: 1.0
Nodes (0):

### Community 46 - "Next Type Declarations"
Cohesion: 1.0
Nodes (0):

### Community 47 - "Clinic Visual Theme"
Cohesion: 1.0
Nodes (1): Clinic Visual Theme

### Community 48 - "Playwright Config"
Cohesion: 1.0
Nodes (0):

### Community 49 - "PostCSS Config"
Cohesion: 1.0
Nodes (0):

### Community 50 - "ESLint Config"
Cohesion: 1.0
Nodes (0):

### Community 51 - "Lazy Settings Drawer"
Cohesion: 1.0
Nodes (0):

### Community 52 - "Inventory Panel Split"
Cohesion: 1.0
Nodes (1): Inventory Panel Catalog Split

### Community 53 - "App Header"
Cohesion: 1.0
Nodes (0):

### Community 54 - "Patient Column"
Cohesion: 1.0
Nodes (0):

### Community 55 - "Billing Settings Panel"
Cohesion: 1.0
Nodes (0):

### Community 56 - "Patient Timeline Panel"
Cohesion: 1.0
Nodes (0):

### Community 57 - "Patient Bio Panel"
Cohesion: 1.0
Nodes (0):

### Community 58 - "Contact Lens Modal"
Cohesion: 1.0
Nodes (0):

### Community 59 - "Myopia Progression Chart"
Cohesion: 1.0
Nodes (0):

### Community 60 - "Clinic Specialty Types"
Cohesion: 1.0
Nodes (0):

### Community 61 - "Myopia Reference Data"
Cohesion: 1.0
Nodes (0):

### Community 62 - "Recent Patients Store"
Cohesion: 1.0
Nodes (1): Recent Patients Store

### Community 63 - "Shared Types"
Cohesion: 1.0
Nodes (0):

### Community 64 - "Follow-Up E2E Spec"
Cohesion: 1.0
Nodes (0):

### Community 65 - "Consultation E2E Spec"
Cohesion: 1.0
Nodes (0):

### Community 66 - "Login E2E Spec"
Cohesion: 1.0
Nodes (0):

### Community 67 - "Patient Chart E2E Spec"
Cohesion: 1.0
Nodes (0):

### Community 68 - "Queue E2E Spec"
Cohesion: 1.0
Nodes (0):

### Community 69 - "Onboarding E2E Spec"
Cohesion: 1.0
Nodes (0):

### Community 70 - "Case Study E2E Spec"
Cohesion: 1.0
Nodes (0):

### Community 71 - "Pytest Fixtures"
Cohesion: 1.0
Nodes (0):

### Community 72 - "Backend Package Init"
Cohesion: 1.0
Nodes (0):

### Community 73 - "Backend Schemas"
Cohesion: 1.0
Nodes (0):

### Community 74 - "Routes Package Init"
Cohesion: 1.0
Nodes (0):

### Community 75 - "Repositories Package Init"
Cohesion: 1.0
Nodes (0):

### Community 76 - "Workflows Package Init"
Cohesion: 1.0
Nodes (0):

### Community 77 - "Common Backend Types"
Cohesion: 1.0
Nodes (0):

### Community 78 - "Services Package Init"
Cohesion: 1.0
Nodes (0):

### Community 79 - "Tests Package Init"
Cohesion: 1.0
Nodes (0):

## Knowledge Gaps
- **9 isolated node(s):** `Clinic Visual Theme`, `Inventory Panel Catalog Split`, `Recent Patients Store`, `Backend Source Of Truth Rationale`, `Pilot Rollback` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Root Layout`** (2 nodes): `RootLayout()`, `layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Add User Page`** (2 nodes): `handleAddUser()`, `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Patient Card`** (2 nodes): `PatientCard()`, `patient-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Letters Settings Panel`** (2 nodes): `SettingsDrawerLetterPanel()`, `settings-drawer-letter-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Myopia Modal`** (2 nodes): `MyopiaManagementModal()`, `myopia-management-modal.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Optometry Modal Shell`** (2 nodes): `OptometryModalShell()`, `optometry-modal-shell.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Health Endpoint`** (2 nodes): `health()`, `health.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Next Type Declarations`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Clinic Visual Theme`** (1 nodes): `Clinic Visual Theme`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Playwright Config`** (1 nodes): `playwright.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `PostCSS Config`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ESLint Config`** (1 nodes): `eslint.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Lazy Settings Drawer`** (1 nodes): `lazy-settings-drawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Inventory Panel Split`** (1 nodes): `Inventory Panel Catalog Split`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `App Header`** (1 nodes): `app-header.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Patient Column`** (1 nodes): `patient-column.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Billing Settings Panel`** (1 nodes): `settings-drawer-billing-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Patient Timeline Panel`** (1 nodes): `patient-timeline-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Patient Bio Panel`** (1 nodes): `patient-bio-data-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Contact Lens Modal`** (1 nodes): `contact-lens-modal.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Myopia Progression Chart`** (1 nodes): `myopia-progression-chart.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Clinic Specialty Types`** (1 nodes): `clinic-specialty.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Myopia Reference Data`** (1 nodes): `myopia-reference.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Recent Patients Store`** (1 nodes): `Recent Patients Store`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Shared Types`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Follow-Up E2E Spec`** (1 nodes): `follow-up.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Consultation E2E Spec`** (1 nodes): `consultation.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Login E2E Spec`** (1 nodes): `login.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Patient Chart E2E Spec`** (1 nodes): `patient-chart.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Queue E2E Spec`** (1 nodes): `queue.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Onboarding E2E Spec`** (1 nodes): `onboarding.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Case Study E2E Spec`** (1 nodes): `case-study.spec.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Pytest Fixtures`** (1 nodes): `conftest.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Backend Package Init`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Backend Schemas`** (1 nodes): `schemas.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Routes Package Init`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Repositories Package Init`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Workflows Package Init`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Common Backend Types`** (1 nodes): `common.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Services Package Init`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Tests Package Init`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `update()` connect `Repository Test Doubles` to `Backend Errors Settings`, `Appointments Audit Workflows`, `Backend Regression Tests`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Why does `Boolean()` connect `Consultation Specialty UI` to `Queue Billing UI`, `Repository Test Doubles`, `Setup Step Modal`?**
  _High betweenness centrality (0.142) - this node is a cross-community bridge._
- **Why does `register()` connect `Backend Regression Tests` to `Registration Admin UI`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Are the 52 inferred relationships involving `register()` (e.g. with `handleSubmit()` and `test_unexpected_route_errors_return_generic_500()`) actually correct?**
  _`register()` has 52 INFERRED edges - model-reasoned connections that need verification._
- **Are the 49 inferred relationships involving `auth_headers()` (e.g. with `test_unexpected_route_errors_return_generic_500()` and `test_billing_finalize_marks_patient_and_deducts_stock_once()`) actually correct?**
  _`auth_headers()` has 49 INFERRED edges - model-reasoned connections that need verification._
- **Are the 40 inferred relationships involving `internal_server_error()` (e.g. with `generate_invoice_pdf()` and `download_user_signature()`) actually correct?**
  _`internal_server_error()` has 40 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Clinic Visual Theme`, `Inventory Panel Catalog Split`, `Recent Patients Store` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._