# Graph Report - .  (2026-04-19)

## Corpus Check
- Corpus is ~44,191 words - fits in a single context window. You may not need a graph.

## Summary
- 479 nodes · 927 edges · 36 communities detected
- Extraction: 73% EXTRACTED · 27% INFERRED · 0% AMBIGUOUS · INFERRED: 250 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Backend Routes|Backend Routes]]
- [[_COMMUNITY_Repository Tests|Repository Tests]]
- [[_COMMUNITY_Database Helpers|Database Helpers]]
- [[_COMMUNITY_API Schemas|API Schemas]]
- [[_COMMUNITY_Frontend Formatters|Frontend Formatters]]
- [[_COMMUNITY_Cross-Layer Contracts|Cross-Layer Contracts]]
- [[_COMMUNITY_Auth And API Tests|Auth And API Tests]]
- [[_COMMUNITY_Token Session Auth|Token Session Auth]]
- [[_COMMUNITY_Clinic Pages|Clinic Pages]]
- [[_COMMUNITY_PDF Rendering|PDF Rendering]]
- [[_COMMUNITY_Appointments Workflow|Appointments Workflow]]
- [[_COMMUNITY_Letter Composer|Letter Composer]]
- [[_COMMUNITY_AI Note Services|AI Note Services]]
- [[_COMMUNITY_Patient Intake|Patient Intake]]
- [[_COMMUNITY_HTTP Client|HTTP Client]]
- [[_COMMUNITY_Patient Details|Patient Details]]
- [[_COMMUNITY_Settings Shell|Settings Shell]]
- [[_COMMUNITY_App Layout|App Layout]]
- [[_COMMUNITY_Patient Cards|Patient Cards]]
- [[_COMMUNITY_Letter Settings|Letter Settings]]
- [[_COMMUNITY_Clinic Shell Hook|Clinic Shell Hook]]
- [[_COMMUNITY_Browser Auth Storage|Browser Auth Storage]]
- [[_COMMUNITY_Next Config|Next Config]]
- [[_COMMUNITY_Next Types|Next Types]]
- [[_COMMUNITY_Theme Config|Theme Config]]
- [[_COMMUNITY_PostCSS Config|PostCSS Config]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Inventory Settings|Inventory Settings]]
- [[_COMMUNITY_User Settings|User Settings]]
- [[_COMMUNITY_Header UI|Header UI]]
- [[_COMMUNITY_Patient Columns|Patient Columns]]
- [[_COMMUNITY_Billing Settings|Billing Settings]]
- [[_COMMUNITY_Shared Types|Shared Types]]
- [[_COMMUNITY_Backend Package|Backend Package]]
- [[_COMMUNITY_Services Package|Services Package]]
- [[_COMMUNITY_Project Overview|Project Overview]]

## God Nodes (most connected - your core abstractions)
1. `SupabaseRepository` - 60 edges
2. `FakeRepo` - 49 edges
3. `register()` - 29 edges
4. `auth_headers()` - 26 edges
5. `_now()` - 19 edges
6. `DuplicateCheckInCandidateError` - 18 edges
7. `write_audit_event()` - 17 edges
8. `build_note_pdf()` - 14 edges
9. `build_invoice_pdf()` - 14 edges
10. `get_patient_timeline()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Backend Owns Database and AI Integrations` --conceptually_related_to--> `Shared Clinic Workspace Hook`  [INFERRED]
  README.md → web/app/page.tsx
- `Deterministic SOAP Note Fallback` --conceptually_related_to--> `Queue Board Workflow`  [INFERRED]
  README.md → web/app/page.tsx
- `Settings and Auth Endpoints` --conceptually_related_to--> `Settings Drawer Hub`  [INFERRED]
  README.md → web/components/settings-drawer.tsx
- `Frontend Patient Type` --semantically_similar_to--> `Backend Patient Schema`  [INFERRED] [semantically similar]
  web/lib/types.ts → backend/app/schemas.py
- `HTTP-only Frontend Boundary` --rationale_for--> `Shared Clinic Workspace Hook`  [EXTRACTED]
  README.md → web/app/page.tsx

## Hyperedges (group relationships)
- **Clinic Shell Pages** — app_page_queue_board_workflow, app_patients_page_registry_search_export, app_history_page_visit_archive_quick_reopen, app_earnings_page_collection_dashboard, app_inventory_page_catalog_manager, app_users_page_staff_manager, app_audit_page_system_activity_feed, app_billing_page_invoice_workbench [INFERRED 0.90]
- **Settings Drawer Panels** — components_settings_drawer_hub, components_settings_drawer_appointments_panel, components_settings_drawer_inventory_panel, components_settings_drawer_users_panel [INFERRED 0.95]
- **Patient Intake Duplicate Resolution** — components_add_patient_modal_intake_matching, components_settings_drawer_appointments_panel, app_patients_page_registry_search_export [INFERRED 0.84]
- **Clinic Shell Surface** — app_header_component, patient_column_component, patient_details_drawer_component, consultation_drawer_component, settings_drawer_letter_panel_component, settings_drawer_billing_panel_component, clinic_shell_hook [INFERRED 0.86]
- **Consultation Note Delivery Flow** — consultation_drawer_component, clinic_shell_hook, anthropic_generation_service, pdf_rendering_service, backend_consultation_note_schema [INFERRED 0.90]

## Communities

### Community 0 - "Backend Routes"
Cohesion: 0.07
Nodes (49): build_csv_response(), build_history_visit_rows(), check_in_appointment(), create_appointment(), create_catalog_item(), create_follow_up(), create_generated_letter(), create_invoice() (+41 more)

### Community 1 - "Repository Tests"
Cohesion: 0.07
Nodes (5): client(), FakeRepo, _normalize_phone(), _now(), ValueError

### Community 2 - "Database Helpers"
Cohesion: 0.06
Nodes (14): _attach_invoice_balances(), _find_check_in_matches(), get_repository(), _normalize_invoice_amount_paid(), _normalize_phone_number(), _round_money(), SupabaseRepository, _visit_payload() (+6 more)

### Community 3 - "API Schemas"
Cohesion: 0.1
Nodes (44): BaseModel, DuplicateCheckInCandidateError, list_audit_events(), AppointmentCheckInRequest, AppointmentCreate, AppointmentUpdate, AuditEventOut, AuthResponse (+36 more)

### Community 4 - "Frontend Formatters"
Cohesion: 0.06
Nodes (13): async(), getAuditMetaLine(), getAuditSummary(), getPatientName(), handleAdvancePatient(), handleCreateBill(), handleCreateInvoice(), handleExport() (+5 more)

### Community 5 - "Cross-Layer Contracts"
Cohesion: 0.09
Nodes (38): Anthropic Generation Service, Blob Request Helper, API Client, Request Helper, App Header, Application Test Suite, Backend Auth User Schema, Backend Clinic Settings Schema (+30 more)

### Community 6 - "Auth And API Tests"
Cohesion: 0.16
Nodes (30): handleSubmit(), auth_headers(), register(), test_admin_can_export_patients_visits_and_invoices_csv(), test_appointment_can_be_created_listed_and_checked_into_queue(), test_appointment_can_be_rescheduled_and_cancelled(), test_appointment_check_in_can_force_new_patient_with_existing_phone(), test_appointment_check_in_can_link_existing_active_patient() (+22 more)

### Community 7 - "Token Session Auth"
Cohesion: 0.12
Nodes (22): _b64decode(), _b64encode(), _build_access_token_payload(), clear_session(), create_access_token(), decode_access_token(), _encode_access_token(), get_current_user() (+14 more)

### Community 8 - "Clinic Pages"
Cohesion: 0.18
Nodes (21): System Activity Feed, Invoice Workbench, Earnings Collection Dashboard, Visit History Quick Reopen, Inventory Catalog Manager, Session Gate and Clinic Registration, Shared Clinic Workspace Hook, Queue Board Workflow (+13 more)

### Community 9 - "PDF Rendering"
Cohesion: 0.29
Nodes (9): build_invoice_pdf(), build_letter_pdf(), build_note_pdf(), _draw_detail_pair_row(), _draw_label_value_line(), _extract_note_body(), _format_display_datetime(), _wrap_text() (+1 more)

### Community 10 - "Appointments Workflow"
Cohesion: 0.18
Nodes (2): handleCheckIn(), handleStartCheckIn()

### Community 11 - "Letter Composer"
Cohesion: 0.17
Nodes (0): 

### Community 12 - "AI Note Services"
Cohesion: 0.25
Nodes (7): build_fallback_letter(), build_fallback_note(), generate_clinic_letter(), generate_soap_note(), BaseSettings, get_settings(), Settings

### Community 13 - "Patient Intake"
Cohesion: 0.36
Nodes (8): getPhoneDigits(), handleClose(), handleSearchExistingPatient(), handleSubmit(), resetForm(), submitPatient(), toCentimeters(), toFahrenheit()

### Community 14 - "HTTP Client"
Cohesion: 0.47
Nodes (7): createTimeoutSignal(), getActiveToken(), isSessionErrorMessage(), request(), requestBlob(), shouldAttachAuth(), syncSessionFromResponse()

### Community 15 - "Patient Details"
Cohesion: 0.29
Nodes (2): getPhoneDigits(), handleSave()

### Community 16 - "Settings Shell"
Cohesion: 0.4
Nodes (0): 

### Community 17 - "App Layout"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Patient Cards"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Letter Settings"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Clinic Shell Hook"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Browser Auth Storage"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Next Config"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Next Types"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Theme Config"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "PostCSS Config"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "ESLint Config"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Inventory Settings"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "User Settings"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Header UI"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Patient Columns"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Billing Settings"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Shared Types"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Backend Package"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Services Package"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Project Overview"
Cohesion: 1.0
Nodes (1): Clinic EMR MVP

## Knowledge Gaps
- **11 isolated node(s):** `Clinic EMR MVP`, `HTTP-only Frontend Boundary`, `Backend Owns Database and AI Integrations`, `Deterministic SOAP Note Fallback`, `Recent Patients Store` (+6 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `App Layout`** (2 nodes): `RootLayout()`, `layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Patient Cards`** (2 nodes): `PatientCard()`, `patient-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Letter Settings`** (2 nodes): `SettingsDrawerLetterPanel()`, `settings-drawer-letter-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Clinic Shell Hook`** (2 nodes): `useClinicShellPage()`, `use-clinic-shell-page.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Browser Auth Storage`** (2 nodes): `isBrowser()`, `auth.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Next Config`** (1 nodes): `next.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Next Types`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Theme Config`** (1 nodes): `tailwind.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `PostCSS Config`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ESLint Config`** (1 nodes): `eslint.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Inventory Settings`** (1 nodes): `settings-drawer-inventory-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `User Settings`** (1 nodes): `settings-drawer-users-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Header UI`** (1 nodes): `app-header.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Patient Columns`** (1 nodes): `patient-column.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Billing Settings`** (1 nodes): `settings-drawer-billing-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Shared Types`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Backend Package`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Services Package`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Project Overview`** (1 nodes): `Clinic EMR MVP`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DuplicateCheckInCandidateError` connect `API Schemas` to `Repository Tests`, `Database Helpers`, `AI Note Services`, `PDF Rendering`?**
  _High betweenness centrality (0.134) - this node is a cross-community bridge._
- **Why does `FakeRepo` connect `Repository Tests` to `API Schemas`, `Auth And API Tests`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Why does `SupabaseRepository` connect `Database Helpers` to `Backend Routes`, `API Schemas`, `AI Note Services`, `Token Session Auth`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Are the 12 inferred relationships involving `SupabaseRepository` (e.g. with `AppointmentCreate` and `AppointmentCheckInRequest`) actually correct?**
  _`SupabaseRepository` has 12 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Clinic EMR MVP`, `HTTP-only Frontend Boundary`, `Backend Owns Database and AI Integrations` to the rest of the system?**
  _11 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Backend Routes` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._
- **Should `Repository Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._