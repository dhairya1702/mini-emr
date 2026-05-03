# Graph Report - /Users/dhairyalalwani/PycharmProjects/mr  (2026-05-03)

## Corpus Check
- 114 files · ~152,706 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 967 nodes · 1973 edges · 59 communities detected
- Extraction: 65% EXTRACTED · 35% INFERRED · 0% AMBIGUOUS · INFERRED: 700 edges (avg confidence: 0.79)
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
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]

## God Nodes (most connected - your core abstractions)
1. `FakeRepo` - 77 edges
2. `register()` - 53 edges
3. `auth_headers()` - 50 edges
4. `write_audit_event()` - 41 edges
5. `RecordsRepositoryMixin` - 29 edges
6. `build_note_pdf()` - 28 edges
7. `_now()` - 27 edges
8. `AuthSettingsRepositoryMixin` - 26 edges
9. `PatientFlowRepositoryMixin` - 24 edges
10. `build_invoice_pdf()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `normalizeVisit()` --calls--> `Boolean()`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/web/app/history/page.tsx → /Users/dhairyalalwani/PycharmProjects/mr/web/components/consultation-drawer.tsx
- `test_pdf_template_page_size_is_read_from_uploaded_pdf()` --calls--> `_page_size_for_template()`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/tests/test_settings.py → /Users/dhairyalalwani/PycharmProjects/mr/backend/app/services/pdf_service.py
- `build_csv_response()` --calls--> `format_export_datetime()`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/backend/app/exports.py → /Users/dhairyalalwani/PycharmProjects/mr/backend/app/formatting.py
- `UserOut` --calls--> `update_user_role()`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/backend/app/schemas.py → /Users/dhairyalalwani/PycharmProjects/mr/backend/app/routes/users.py
- `handleSubmit()` --calls--> `register()`  [INFERRED]
  /Users/dhairyalalwani/PycharmProjects/mr/web/app/follow-up/page.tsx → /Users/dhairyalalwani/PycharmProjects/mr/tests/test_app.py

## Hyperedges (group relationships)
- **Clinic Shell Pages** — app_page_queue_board_workflow, app_patients_page_registry_search_export, app_history_page_visit_archive_quick_reopen, app_earnings_page_collection_dashboard, app_inventory_page_catalog_manager, app_users_page_staff_manager, app_audit_page_system_activity_feed, app_billing_page_invoice_workbench [INFERRED 0.90]
- **Settings Drawer Panels** — components_settings_drawer_hub, components_settings_drawer_appointments_panel, components_settings_drawer_inventory_panel, components_settings_drawer_users_panel [INFERRED 0.95]
- **Patient Intake Duplicate Resolution** — components_add_patient_modal_intake_matching, components_settings_drawer_appointments_panel, app_patients_page_registry_search_export [INFERRED 0.84]
- **Clinic Shell Surface** — app_header_component, patient_column_component, patient_details_drawer_component, consultation_drawer_component, settings_drawer_letter_panel_component, settings_drawer_billing_panel_component, clinic_shell_hook [INFERRED 0.86]
- **Consultation Note Delivery Flow** — consultation_drawer_component, clinic_shell_hook, anthropic_generation_service, pdf_rendering_service, backend_consultation_note_schema [INFERRED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (76): check_in_appointment_workflow(), create_appointment_workflow(), update_appointment_workflow(), check_in_appointment(), create_appointment(), list_appointments(), update_appointment(), get_actor_name() (+68 more)

### Community 1 - "Community 1"
Cohesion: 0.04
Nodes (8): update(), validate_appointments_per_hour(), validate_booking_window(), client(), FakeRepo, _normalize_phone(), _now(), ValueError

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (72): list_audit_events(), DuplicateCheckInCandidateError, BaseModel, AppointmentCheckInRequest, AppointmentCreate, AppointmentUpdate, AuditEventOut, BinocularVisionInput (+64 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (54): downloadBlob(), handleExportPdf(), handleGenerate(), handleSelectPatient(), resetDraft(), _append_pdf_bytes(), _apply_pdf_template(), build_case_study_pdf() (+46 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (56): auth_headers(), register(), test_case_study_generation_storage_and_pdf(), test_myopia_measurements_create_history_and_timeline(), test_public_follow_up_booking_reschedules_and_creates_appointment(), test_schedule_lists_auto_cancel_expired_items(), _future_iso(), test_appointment_can_be_created_listed_and_checked_into_queue() (+48 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (41): _b64decode(), _b64encode(), _build_access_token_payload(), clear_session(), create_access_token(), decode_access_token(), delete_my_signature(), download_my_signature() (+33 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (31): build_clinic_context(), build_measurements_context(), build_patient_context(), _render_pipe_table(), _build_sender(), send_clinic_email_message(), generate_letter_content(), generate_note_workflow() (+23 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (42): user_names_by_id(), list_invoices_with_user_names(), create_case_study(), _document_context_for_current_user(), generate_case_study(), generate_case_study_pdf(), get_case_study(), list_case_studies() (+34 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (27): Boolean(), buildBinocularVisionSummary(), buildLowVisionSummary(), buildMyopiaManagementSummary(), clearWorkspace(), createEmptyBinocularVision(), createEmptyForm(), createEmptyLowVision() (+19 more)

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (20): async(), buildAutoDraftInvoiceItems(), createEmptyQueueOrder(), createId(), extractMedicineSuggestions(), extractStructuredPrescriptionItems(), handleAdvancePatient(), handleCreateBill() (+12 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (22): AIUsageRepositoryMixin, AIUsageRepositoryMixin, AuditRepositoryMixin, AuditRepositoryMixin, AuthSettingsRepositoryMixin, BaseSupabaseRepository, BaseSupabaseRepository, BillingRepositoryMixin (+14 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (26): anthropic_usage_from_response(), record_anthropic_usage(), build_fallback_case_study(), build_fallback_letter(), build_fallback_note(), _extract_pipe_table_blocks(), generate_case_study_document(), generate_clinic_letter() (+18 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (19): preview_check_in_appointment(), attach_invoice_balances(), find_check_in_matches(), normalize_invoice_amount_paid(), normalize_phone_number(), round_money(), visit_payload(), build_csv_response() (+11 more)

### Community 13 - "Community 13"
Cohesion: 0.1
Nodes (4): createEmptyHistoricalMyopia(), formatLocalDateTimeInput(), getPhoneDigits(), handleSave()

### Community 14 - "Community 14"
Cohesion: 0.12
Nodes (10): useClinicShell(), formatDateTime(), handleContinueRegistration(), handleModeChange(), handleSubmit(), loadContext(), resetRegisterFields(), SuperuserPage() (+2 more)

### Community 15 - "Community 15"
Cohesion: 0.13
Nodes (2): handleCheckIn(), handleStartCheckIn()

### Community 16 - "Community 16"
Cohesion: 0.3
Nodes (14): buildRequestHeaders(), canRetrySafely(), createTimeoutSignal(), delay(), getActiveToken(), getRequestMethod(), isSessionErrorMessage(), performFetch() (+6 more)

### Community 17 - "Community 17"
Cohesion: 0.15
Nodes (1): _RecordingCanvas

### Community 18 - "Community 18"
Cohesion: 0.36
Nodes (8): getPhoneDigits(), handleClose(), handleSearchExistingPatient(), handleSubmit(), resetForm(), submitPatient(), toCentimeters(), toFahrenheit()

### Community 19 - "Community 19"
Cohesion: 0.36
Nodes (8): _literal_values(), _parse_ts_interfaces(), _parse_ts_unions(), _schema_properties(), _schema_property_set(), test_frontend_enum_unions_match_backend_openapi(), test_frontend_request_contracts_match_backend_openapi(), test_frontend_response_contracts_match_backend_openapi()

### Community 20 - "Community 20"
Cohesion: 0.32
Nodes (3): getAuditSummary(), getPatientName(), inferPatientNameFromSummary()

### Community 21 - "Community 21"
Cohesion: 0.25
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 0.33
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 0.5
Nodes (2): normalizePreviewMargin(), previewInsetStyles()

### Community 24 - "Community 24"
Cohesion: 0.4
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 0.5
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 0.5
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
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (1): Clinic Visual Theme

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (1): Inventory Panel Catalog Split

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
Nodes (1): Recent Patients Store

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (0): 

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (0): 

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (1): Clinic EMR MVP

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (1): HTTP-only Frontend Boundary

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (1): Backend Owns Database and AI Integrations

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (1): Deterministic SOAP Note Fallback

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (1): Settings and Auth Endpoints

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (1): Backend Dependency Stack

## Knowledge Gaps
- **9 isolated node(s):** `Clinic Visual Theme`, `Inventory Panel Catalog Split`, `Recent Patients Store`, `Clinic EMR MVP`, `HTTP-only Frontend Boundary` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 27`** (2 nodes): `RootLayout()`, `layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `handleAddUser()`, `page.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `PatientCard()`, `patient-card.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `SettingsDrawerLetterPanel()`, `settings-drawer-letter-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `isBrowser()`, `auth.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `health()`, `health.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `next.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `Clinic Visual Theme`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (1 nodes): `eslint.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `lazy-settings-drawer.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `Inventory Panel Catalog Split`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `app-header.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `patient-column.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `settings-drawer-billing-panel.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `clinic-specialty.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (1 nodes): `myopia-reference.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `Recent Patients Store`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `conftest.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (1 nodes): `Clinic EMR MVP`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `HTTP-only Frontend Boundary`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `Backend Owns Database and AI Integrations`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `Deterministic SOAP Note Fallback`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `Settings and Auth Endpoints`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `Backend Dependency Stack`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `update()` connect `Community 1` to `Community 8`, `Community 4`, `Community 12`?**
  _High betweenness centrality (0.151) - this node is a cross-community bridge._
- **Why does `PatientFlowRepositoryMixin` connect `Community 12` to `Community 0`, `Community 10`, `Community 2`, `Community 7`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `register()` connect `Community 4` to `Community 14`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Are the 48 inferred relationships involving `register()` (e.g. with `handleSubmit()` and `test_billing_finalize_marks_patient_and_deducts_stock_once()`) actually correct?**
  _`register()` has 48 INFERRED edges - model-reasoned connections that need verification._
- **Are the 45 inferred relationships involving `auth_headers()` (e.g. with `test_billing_finalize_marks_patient_and_deducts_stock_once()` and `test_invoice_can_be_created_with_partial_payment_status()`) actually correct?**
  _`auth_headers()` has 45 INFERRED edges - model-reasoned connections that need verification._
- **Are the 26 inferred relationships involving `write_audit_event()` (e.g. with `create_staff_user_workflow()` and `.create_audit_event()`) actually correct?**
  _`write_audit_event()` has 26 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Clinic Visual Theme`, `Inventory Panel Catalog Split`, `Recent Patients Store` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._