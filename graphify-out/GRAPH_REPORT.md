# Graph Report - /Users/dhairyalalwani/PycharmProjects/mr  (2026-04-19)

## Corpus Check
- 86 files · ~75,163 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 396 nodes · 704 edges · 37 communities detected
- Extraction: 57% EXTRACTED · 43% INFERRED · 0% AMBIGUOUS · INFERRED: 304 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `FakeRepo` - 48 edges
2. `write_audit_event()` - 35 edges
3. `register()` - 28 edges
4. `auth_headers()` - 26 edges
5. `_now()` - 19 edges
6. `PatientFlowRepositoryMixin` - 18 edges
7. `RecordsRepositoryMixin` - 14 edges
8. `generate_note_workflow()` - 13 edges
9. `BillingRepositoryMixin` - 12 edges
10. `AuthSettingsRepositoryMixin` - 12 edges

## Surprising Connections (you probably didn't know these)
- `Queue Board Workflow` --conceptually_related_to--> `Deterministic SOAP Note Fallback`  [INFERRED]
  web/app/page.tsx → README.md
- `Shared Clinic Workspace Hook` --conceptually_related_to--> `Backend Owns Database and AI Integrations`  [INFERRED]
  web/app/page.tsx → README.md
- `Settings Drawer Hub` --conceptually_related_to--> `Settings and Auth Endpoints`  [INFERRED]
  web/components/settings-drawer.tsx → README.md
- `PDF Rendering Service` --conceptually_related_to--> `Backend Dependency Stack`  [INFERRED]
  backend/app/services/pdf_service.py → backend/requirements.txt
- `Anthropic Generation Service` --conceptually_related_to--> `Backend Dependency Stack`  [INFERRED]
  backend/app/services/anthropic_service.py → backend/requirements.txt

## Hyperedges (group relationships)
- **Clinic Shell Pages** — app_page_queue_board_workflow, app_patients_page_registry_search_export, app_history_page_visit_archive_quick_reopen, app_earnings_page_collection_dashboard, app_inventory_page_catalog_manager, app_users_page_staff_manager, app_audit_page_system_activity_feed, app_billing_page_invoice_workbench [INFERRED 0.90]
- **Settings Drawer Panels** — components_settings_drawer_hub, components_settings_drawer_appointments_panel, components_settings_drawer_inventory_panel, components_settings_drawer_users_panel [INFERRED 0.95]
- **Patient Intake Duplicate Resolution** — components_add_patient_modal_intake_matching, components_settings_drawer_appointments_panel, app_patients_page_registry_search_export [INFERRED 0.84]
- **Clinic Shell Surface** — app_header_component, patient_column_component, patient_details_drawer_component, consultation_drawer_component, settings_drawer_letter_panel_component, settings_drawer_billing_panel_component, clinic_shell_hook [INFERRED 0.86]
- **Consultation Note Delivery Flow** — consultation_drawer_component, clinic_shell_hook, anthropic_generation_service, pdf_rendering_service, backend_consultation_note_schema [INFERRED 0.90]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (5): client(), FakeRepo, _normalize_phone(), _now(), ValueError

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (34): check_in_appointment_workflow(), create_appointment_workflow(), update_appointment_workflow(), check_in_appointment(), create_appointment(), update_appointment(), get_actor_name(), record_appointment_checked_in() (+26 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (30): auth_headers(), register(), test_appointment_can_be_created_listed_and_checked_into_queue(), test_appointment_can_be_rescheduled_and_cancelled(), test_appointment_check_in_can_force_new_patient_with_existing_phone(), test_appointment_check_in_can_link_existing_active_patient(), test_appointment_check_in_preview_returns_active_phone_matches(), test_appointment_check_in_requires_explicit_choice_when_phone_has_active_matches() (+22 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (19): build_clinic_context(), build_measurements_context(), build_patient_context(), finalize_note_workflow(), generate_letter_content(), generate_note_workflow(), send_note_workflow(), create_generated_letter() (+11 more)

### Community 4 - "Community 4"
Cohesion: 0.11
Nodes (21): _b64decode(), _b64encode(), _build_access_token_payload(), clear_session(), create_access_token(), decode_access_token(), _encode_access_token(), enforce_rate_limit() (+13 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (13): preview_check_in_appointment(), AuditRepositoryMixin, attach_invoice_balances(), BaseSupabaseRepository, DuplicateCheckInCandidateError, find_check_in_matches(), normalize_invoice_amount_paid(), normalize_phone_number() (+5 more)

### Community 6 - "Community 6"
Cohesion: 0.19
Nodes (15): user_names_by_id(), list_invoices_with_user_names(), build_visit_description(), format_money(), build_patient_timeline_view(), build_user_name_map(), enrich_invoices_with_completer_names(), enrich_notes_with_sender_names() (+7 more)

### Community 7 - "Community 7"
Cohesion: 0.18
Nodes (20): System Activity Feed, Invoice Workbench, Earnings Collection Dashboard, Visit History Quick Reopen, Inventory Catalog Manager, Session Gate and Clinic Registration, Shared Clinic Workspace Hook, Queue Board Workflow (+12 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (18): Anthropic Generation Service, App Header, Backend Clinic Settings Schema, Backend Consultation Note Schema, Backend Dependency Stack, Backend Invoice Schema, Backend Patient Schema, Draft Invoice Item (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.22
Nodes (12): list_invoices(), build_csv_response(), build_history_visit_rows(), export_invoices_csv(), export_patients_csv(), export_visits_csv(), filter_rows_by_created_at(), get_export_range_start() (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (3): BillingRepositoryMixin, list_catalog(), update_catalog_stock()

### Community 11 - "Community 11"
Cohesion: 0.18
Nodes (1): _DummyCanvas

### Community 12 - "Community 12"
Cohesion: 0.36
Nodes (8): _literal_values(), _parse_ts_interfaces(), _parse_ts_unions(), _schema_properties(), _schema_property_set(), test_frontend_enum_unions_match_backend_openapi(), test_frontend_request_contracts_match_backend_openapi(), test_frontend_response_contracts_match_backend_openapi()

### Community 13 - "Community 13"
Cohesion: 0.47
Nodes (7): createTimeoutSignal(), getActiveToken(), isSessionErrorMessage(), request(), requestBlob(), shouldAttachAuth(), syncSessionFromResponse()

### Community 14 - "Community 14"
Cohesion: 0.25
Nodes (7): AuditRepositoryMixin, AuthSettingsRepositoryMixin, BillingRepositoryMixin, get_repository(), SupabaseRepository, PatientFlowRepositoryMixin, RecordsRepositoryMixin

### Community 15 - "Community 15"
Cohesion: 0.67
Nodes (0): 

### Community 16 - "Community 16"
Cohesion: 1.0
Nodes (0): 

### Community 17 - "Community 17"
Cohesion: 1.0
Nodes (0): 

### Community 18 - "Community 18"
Cohesion: 1.0
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 1.0
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 1.0
Nodes (0): 

### Community 21 - "Community 21"
Cohesion: 1.0
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 1.0
Nodes (1): Recent Patients Store

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
Nodes (1): Backend Patient Timeline Event Schema

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (1): Backend Auth User Schema

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (1): Backend Generate Note Request Schema

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (1): Backend Generate Letter Request Schema

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
Nodes (1): Clinic EMR MVP

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (1): HTTP-only Frontend Boundary

## Knowledge Gaps
- **20 isolated node(s):** `App Header`, `Letter Form State`, `Patient Column`, `Patient Details Drawer`, `Draft Invoice Item` (+15 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 16`** (2 nodes): `RootLayout()`, `layout.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (2 nodes): `lifespan()`, `main.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 18`** (2 nodes): `list_audit_events()`, `audit.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (2 nodes): `health()`, `health.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (1 nodes): `next.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 21`** (1 nodes): `next-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (1 nodes): `postcss.config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 23`** (1 nodes): `eslint.config.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 24`** (1 nodes): `Recent Patients Store`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (1 nodes): `conftest.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 27`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (1 nodes): `Backend Patient Timeline Event Schema`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (1 nodes): `Backend Auth User Schema`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (1 nodes): `Backend Generate Note Request Schema`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `Backend Generate Letter Request Schema`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `__init__.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `Clinic EMR MVP`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `HTTP-only Frontend Boundary`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `generate_note_workflow()` connect `Community 3` to `Community 1`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.152) - this node is a cross-community bridge._
- **Why does `PatientFlowRepositoryMixin` connect `Community 5` to `Community 9`, `Community 6`?**
  _High betweenness centrality (0.143) - this node is a cross-community bridge._
- **Why does `write_audit_event()` connect `Community 1` to `Community 10`, `Community 3`, `Community 5`?**
  _High betweenness centrality (0.122) - this node is a cross-community bridge._
- **Are the 23 inferred relationships involving `write_audit_event()` (e.g. with `update_catalog_stock()` and `.create_audit_event()`) actually correct?**
  _`write_audit_event()` has 23 INFERRED edges - model-reasoned connections that need verification._
- **Are the 27 inferred relationships involving `register()` (e.g. with `test_billing_finalize_marks_patient_and_deducts_stock_once()` and `test_invoice_can_be_created_with_partial_payment_status()`) actually correct?**
  _`register()` has 27 INFERRED edges - model-reasoned connections that need verification._
- **Are the 25 inferred relationships involving `auth_headers()` (e.g. with `test_billing_finalize_marks_patient_and_deducts_stock_once()` and `test_invoice_can_be_created_with_partial_payment_status()`) actually correct?**
  _`auth_headers()` has 25 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `ValueError` (e.g. with `.check_in_appointment()` and `.update_appointment()`) actually correct?**
  _`ValueError` has 17 INFERRED edges - model-reasoned connections that need verification._