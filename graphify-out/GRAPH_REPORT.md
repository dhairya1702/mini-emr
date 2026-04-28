# Graph Report - /Users/dhairyalalwani/PycharmProjects/mr  (2026-04-28)

## Corpus Check
- 101 files · ~98,287 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 776 nodes · 1553 edges · 52 communities detected
- Extraction: 64% EXTRACTED · 36% INFERRED · 0% AMBIGUOUS · INFERRED: 559 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]

## God Nodes (most connected - your core abstractions)
1. `FakeRepo` - 63 edges
2. `register()` - 45 edges
3. `auth_headers()` - 42 edges
4. `write_audit_event()` - 39 edges
5. `build_note_pdf()` - 28 edges
6. `AuthSettingsRepositoryMixin` - 26 edges
7. `PatientFlowRepositoryMixin` - 24 edges
8. `_now()` - 23 edges
9. `build_invoice_pdf()` - 22 edges
10. `RecordsRepositoryMixin` - 20 edges

## Surprising Connections (you probably didn't know these)
- `test_pdf_template_page_size_is_read_from_uploaded_pdf()` --calls--> `_page_size_for_template()`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/tests/test_settings.py → /Users/dhairyalalwani/PycharmProjects/mr/backend/app/services/pdf_service.py
- `create_invoice()` --calls--> `create_invoice_workflow()`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/backend/app/routes/billing.py → /Users/dhairyalalwani/PycharmProjects/mr/backend/app/services/billing_workflow.py
- `send_invoice()` --calls--> `send_invoice_workflow()`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/backend/app/routes/billing.py → /Users/dhairyalalwani/PycharmProjects/mr/backend/app/services/billing_workflow.py
- `handleSubmit()` --calls--> `register()`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/web/app/follow-up/page.tsx → /Users/dhairyalalwani/PycharmProjects/mr/tests/test_app.py
- `test_build_clinic_and_measurement_contexts_include_structured_fields()` --calls--> `GenerateNoteRequest`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/tests/test_contracts.py → /Users/dhairyalalwani/PycharmProjects/mr/backend/app/schemas.py

## Hyperedges (group relationships)
- **Clinic Shell Pages** — app_page_queue_board_workflow, app_patients_page_registry_search_export, app_history_page_visit_archive_quick_reopen, app_earnings_page_collection_dashboard, app_inventory_page_catalog_manager, app_users_page_staff_manager, app_audit_page_system_activity_feed, app_billing_page_invoice_workbench [INFERRED 0.90]
- **Settings Drawer Panels** — components_settings_drawer_hub, components_settings_drawer_appointments_panel, components_settings_drawer_inventory_panel, components_settings_drawer_users_panel [INFERRED 0.95]
- **Patient Intake Duplicate Resolution** — components_add_patient_modal_intake_matching, components_settings_drawer_appointments_panel, app_patients_page_registry_search_export [INFERRED 0.84]
- **Clinic Shell Surface** — app_header_component, patient_column_component, patient_details_drawer_component, consultation_drawer_component, settings_drawer_letter_panel_component, settings_drawer_billing_panel_component, clinic_shell_hook [INFERRED 0.86]
- **Consultation Note Delivery Flow** — consultation_drawer_component, clinic_shell_hook, anthropic_generation_service, pdf_rendering_service, backend_consultation_note_schema [INFERRED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (63): AIUsageRepositoryMixin, preview_check_in_appointment(), list_audit_events(), attach_invoice_balances(), BaseSupabaseRepository, DuplicateCheckInCandidateError, find_check_in_matches(), normalize_invoice_amount_paid() (+55 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (60): check_in_appointment_workflow(), create_appointment_workflow(), update_appointment_workflow(), check_in_appointment(), create_appointment(), list_appointments(), update_appointment(), AuditRepositoryMixin (+52 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (5): client(), FakeRepo, _normalize_phone(), _now(), ValueError

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (42): _b64decode(), _b64encode(), _build_access_token_payload(), clear_session(), create_access_token(), decode_access_token(), delete_my_signature(), download_my_signature() (+34 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (48): auth_headers(), register(), test_public_follow_up_booking_reschedules_and_creates_appointment(), test_schedule_lists_auto_cancel_expired_items(), _future_iso(), test_appointment_can_be_created_listed_and_checked_into_queue(), test_appointment_can_be_rescheduled_and_cancelled(), test_appointment_check_in_can_force_new_patient_with_existing_phone() (+40 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (41): _append_pdf_bytes(), _apply_pdf_template(), build_invoice_pdf(), build_letter_pdf(), _build_note_asset_pdf(), _build_note_assets_pdf(), build_note_pdf(), _build_note_pdf_attachment_pdf() (+33 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (19): async(), buildAutoDraftInvoiceItems(), createEmptyQueueOrder(), createId(), extractMedicineSuggestions(), getAuditSummary(), getPatientName(), handleAdvancePatient() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (29): build_clinic_context(), build_measurements_context(), build_patient_context(), _render_pipe_table(), finalize_note_workflow(), generate_letter_content(), generate_note_workflow(), send_letter_workflow() (+21 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (31): user_names_by_id(), create_invoice(), generate_invoice_pdf(), list_invoices(), send_invoice(), list_invoices_with_user_names(), build_csv_response(), build_history_visit_rows() (+23 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (8): clearWorkspace(), createEmptyForm(), createId(), handleDone(), handleSend(), readWorkspace(), workspaceKey(), writeWorkspace()

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (21): AIUsageRepositoryMixin, AuditRepositoryMixin, AuthSettingsRepositoryMixin, BaseSettings, BillingRepositoryMixin, get_settings(), Settings, get_repository() (+13 more)

### Community 11 - "Community 11"
Cohesion: 0.13
Nodes (18): anthropic_usage_from_response(), record_anthropic_usage(), build_fallback_letter(), build_fallback_note(), _extract_pipe_table_blocks(), generate_clinic_letter(), generate_soap_note(), _match_section_label() (+10 more)

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (2): handleCheckIn(), handleStartCheckIn()

### Community 13 - "Community 13"
Cohesion: 0.15
Nodes (1): _RecordingCanvas

### Community 14 - "Community 14"
Cohesion: 0.44
Nodes (9): buildRequestHeaders(), createTimeoutSignal(), getActiveToken(), isSessionErrorMessage(), request(), requestBlob(), requestForm(), shouldAttachAuth() (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.27
Nodes (6): handleContinueRegistration(), handleModeChange(), handleSubmit(), loadContext(), resetRegisterFields(), toLocalDateTimeInput()

### Community 16 - "Community 16"
Cohesion: 0.36
Nodes (8): getPhoneDigits(), handleClose(), handleSearchExistingPatient(), handleSubmit(), resetForm(), submitPatient(), toCentimeters(), toFahrenheit()

### Community 17 - "Community 17"
Cohesion: 0.36
Nodes (8): _literal_values(), _parse_ts_interfaces(), _parse_ts_unions(), _schema_properties(), _schema_property_set(), test_frontend_enum_unions_match_backend_openapi(), test_frontend_request_contracts_match_backend_openapi(), test_frontend_response_contracts_match_backend_openapi()

### Community 18 - "Community 18"
Cohesion: 0.25
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (2): getPhoneDigits(), handleSave()

### Community 20 - "Community 20"
Cohesion: 0.5
Nodes (2): normalizePreviewMargin(), previewInsetStyles()

### Community 21 - "Community 21"
Cohesion: 0.4
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 0.5
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (1): Clinic Visual Theme

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (1): Inventory Panel Catalog Split

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (1): Recent Patients Store

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (1): Client Session Storage

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (1): Clinic EMR MVP

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (1): HTTP-only Frontend Boundary

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (1): Backend Owns Database and AI Integrations

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (1): Deterministic SOAP Note Fallback

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (1): Settings and Auth Endpoints

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (1): Backend Dependency Stack

## Knowledge Gaps
- **10 isolated node(s):** `Clinic Visual Theme`, `Inventory Panel Catalog Split`, `Recent Patients Store`, `Client Session Storage`, `Clinic EMR MVP` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 23`** (2 nodes): `RootLayout()`, `layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (2 nodes): `PatientCard()`, `patient-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (2 nodes): `SettingsDrawerLetterPanel()`, `settings-drawer-letter-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (2 nodes): `useClinicShellPage()`, `use-clinic-shell-page.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (2 nodes): `health()`, `health.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `next.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `Clinic Visual Theme`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `eslint.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `Inventory Panel Catalog Split`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `app-header.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `patient-column.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `settings-drawer-billing-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `Recent Patients Store`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `Client Session Storage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `conftest.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `Clinic EMR MVP`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `HTTP-only Frontend Boundary`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `Backend Owns Database and AI Integrations`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `Deterministic SOAP Note Fallback`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `Settings and Auth Endpoints`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `Backend Dependency Stack`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `generate_note_workflow()` connect `Community 7` to `Community 0`, `Community 1`, `Community 3`, `Community 8`, `Community 11`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Why does `FakeRepo` connect `Community 2` to `Community 4`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **Why does `register()` connect `Community 4` to `Community 15`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Are the 42 inferred relationships involving `register()` (e.g. with `handleSubmit()` and `test_billing_finalize_marks_patient_and_deducts_stock_once()`) actually correct?**
  _`register()` has 42 INFERRED edges - model-reasoned connections that need verification._
- **Are the 39 inferred relationships involving `auth_headers()` (e.g. with `test_billing_finalize_marks_patient_and_deducts_stock_once()` and `test_invoice_can_be_created_with_partial_payment_status()`) actually correct?**
  _`auth_headers()` has 39 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `write_audit_event()` (e.g. with `create_staff_user_workflow()` and `.create_audit_event()`) actually correct?**
  _`write_audit_event()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Clinic Visual Theme`, `Inventory Panel Catalog Split`, `Recent Patients Store` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._