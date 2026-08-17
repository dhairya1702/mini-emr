# Consultation Refactor Plan

## Objective

Reduce change risk in the consultation, patient chart, and dashboard hotspots through behavior-preserving workflow extractions. Each slice must keep API contracts, navigation, training-mode behavior, and user-visible workflow sequencing intact.

## Guardrails

- Extract one workflow or pure domain boundary at a time.
- Do not combine visual redesigns with state or side-effect movement.
- Keep the existing component exports while consumers migrate.
- Preserve desktop and mobile views; share domain behavior rather than forcing shared presentation.
- Add characterization coverage before moving async state ownership.
- Run focused checks first, followed by full frontend lint and build.

## Slice 1: Pure model boundaries

Status: implemented on `consul-refactor`.

### Scope

1. Extract consultation form initialization into a typed factory.
2. Extract medication-table and prescription-note transformations.
3. Extract structured-module and consultation note payload construction.
4. Extract billing draft parsing and automatic item generation.
5. Reuse the existing structured-module summary and ordering helpers.
6. Add deterministic characterization tests for these transformations.

### Explicitly out of scope

- React state ownership
- Consultation autosave or hydration
- Note generation/finalization sequencing
- Queue polling, SSE, drag/drop, or optimistic mutations
- UI or styling changes
- Backend exception handling
- API request or response changes

### Acceptance criteria

- Extracted functions receive explicit inputs and can be tested without rendering React.
- ID and time sources are injectable where deterministic testing requires them.
- Dashboard and desktop billing use one billing draft implementation.
- Existing component entry points remain unchanged.
- Focused characterization tests pass.
- Full frontend lint and production build pass.
- Existing consultation and billing smoke tests show no refactor-related regression.

## Next slices

### Slice 2: Billing workspace

Status: implemented on `consul-refactor` after the Slice 1 checkpoint.

- Move billing state, catalog/note loading, draft seeding, save/finalize, PDF, and delivery into a billing workflow controller.
- Extract the billing overlay from the dashboard page.
- Keep queue synchronization untouched.

Acceptance coverage includes lazy catalog loading, dirty-draft preservation, patient-to-patient reset, save-before-finalize ordering, retry after finalization failure without duplicate invoice creation, and successful completion.

### Slice 3: Patient chart resources

Status: in progress. Slice 3A (profile photos and attachments), Slice 3B (chart data loading), and Slice 3C (patient editing) are implemented on `consul-refactor`.

- Extract profile photo and attachment workflows first.
- Then extract summary, timeline, visits, structured tests, and patient editing.
- Replace mutually exclusive modal booleans with a discriminated modal state.

Slice 3A owns lazy attachment/note loading, note-asset deduplication, attachment upload/delete/send/open behavior, cached-visit cleanup, profile-photo validation/mutations, image preview state, and blob URL cleanup. Characterization coverage protects lazy loading, mutations, failure reset, patient switching, and profile-photo validation.

Slice 3B owns eager visit/summary loading, visit selection and detail caching, lazy timeline loading/retry, patient reset, timeline invalidation after clinical mutations, and the attachment-deletion bridge into cached visit details. Characterization coverage protects cache reuse, independent failures, retry behavior, refresh preservation, and patient switching.

Slice 3C owns patient edit-form initialization, draft transitions, validation, payload normalization, save/retry state, and patient reset. One shared form now serves both chart layouts, with characterization coverage for validation, unsaved-draft preservation, normalized saves, failure retry, and patient switching.

### Slice 4: Consultation leaf workflows

- Extract attachments, prescriptions, assistant, delivery, and specialty module controllers.
- Keep the main note lifecycle in place until its dependencies are isolated.

### Slice 5: Consultation session and note lifecycle

- Introduce a consultation reducer for durable session state.
- Isolate hydration/autosave.
- Extract generate, save, finalize, send, complete, and workspace-clear transitions.
- Share domain and lifecycle behavior with mobile while retaining separate views.

### Slice 6: Dashboard queue and synchronization

- Extract workspace routing, check-ins, refresh/backoff/SSE coordination, queue mutations, and drag/drop.
- Leave the route component responsible only for composition and top-level loading states.

### Slice 7: Backend boundaries

- Establish explicit domain, integration, unexpected, and best-effort exception policies.
- Migrate route modules incrementally to centralized safe error mapping.
- Split the patient route module by queue, chart, attachments, specialty modules, and profile-photo workflows.
