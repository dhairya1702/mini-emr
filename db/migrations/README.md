# Migrations

Standalone, incremental SQL changes for databases that are **already live**.

`../schema.sql` remains the full schema target for fresh databases (it already
includes everything here). These files exist so you can apply a single change to
an existing Cloud SQL / Postgres instance without re-running the whole schema.

Each migration is idempotent (`add column if not exists`, etc.) and wrapped in a
transaction, so it is safe to run more than once.

Apply one with:

```bash
psql "$DATABASE_URL" -f db/migrations/<file>.sql
```

## Index

| Date       | File                                  | Summary                                        |
| ---------- | ------------------------------------- | ---------------------------------------------- |
| 2026-06-24 | `2026-06-24_patient_ai_summary.sql`   | Adds `ai_summary`, `ai_summary_updated_at`, `ai_summary_stale` to `patients` for the AI chart summary cache. |
| 2026-06-24 | `2026-06-24_customer_onboarding.sql`  | Adds approved customer/CID onboarding records for gated clinic signup. |
| 2026-06-27 | `2026-06-27_auth_hardening.sql`       | Adds revocable per-user session versions. |
| 2026-06-27 | `2026-06-27_rate_limits.sql`          | Adds shared, atomic API rate-limit counters. |
| 2026-06-27 | `2026-06-27_patient_summary_revision.sql` | Prevents stale AI summary writes from winning races. |
| 2026-06-27 | `2026-06-27_financial_precision.sql`  | Converts money and stock quantities to fixed-precision numerics. |
| 2026-06-27 | `2026-06-27_api_request_metrics.sql`  | Adds daily request/error counters for a real platform error rate. |
| 2026-06-27 | `2026-06-27_tenant_integrity.sql`     | Enforces same-organization references for clinical child records. |
| 2026-07-13 | `2026-07-13_ops_workspace_mode.sql`   | Persists the Ops-selected solo/team workspace mode on customer onboarding records. |
| 2026-07-13 | `2026-07-13_ops_user_limits.sql`      | Persists and safely backfills the Ops-managed user limit for every clinic. |
| 2026-07-13 | `2026-07-13_shared_queue_board.sql`   | Adds shared queue ordering, explicit urgency, and per-stage timing. |
| 2026-07-13 | `2026-07-13_queue_context.sql`        | Adds optional sex/gender demographics, current visit context, and visit-linked billing summaries. |
| 2026-07-13 | `2026-07-13_queue_visit_provenance.sql` | Distinguishes walk-ins and ordinary appointments from visits explicitly booked through follow-up. |
| 2026-07-14 | `2026-07-14_follow_up_reminder_claims.sql` | Adds leased, concurrency-safe claiming and delivery-attempt metadata for follow-up reminders. |
| 2026-07-15 | `2026-07-15_patient_summary_visit_links.sql` | Links consultation notes to visits and fingerprints the rolling two-visit patient summary source. |
| 2026-07-22 | `2026-07-22_whatsapp_owner_assistant.sql` | Adds WhatsApp owner bindings and message-event audit records for the owner assistant pilot. |
| 2026-07-29 | `2026-07-29_myopia_care_program.sql` | Adds catalog-backed Myopia Care programs, patient enrollments, and program events. |
| 2026-07-29 | `2026-07-29_whatsapp_document_delivery.sql` | Adds document linkage, idempotency, and provider delivery states to WhatsApp message events. |
| 2026-07-29 | `2026-07-29_platform_email_sender.sql` | Adds the encrypted ClinicOS Gmail sender and per-clinic sender selection. |
| 2026-07-29 | `2026-07-29_persistent_follow_up_booking.sql` | Makes a follow-up booking link reusable for booking, rescheduling, cancellation, and rebooking against one appointment. |
| 2026-07-30 | `2026-07-30_optometry_history.sql` | Adds persistent, revisioned optometry patient details and immutable consultation-note snapshots. |
| 2026-07-30 | `2026-07-30_item_level_gst.sql` | Adds optional HSN/SAC and GST configuration with immutable invoice-line tax snapshots. |
| 2026-07-29 | `2026-07-29_public_queue_check_in.sql` | Adds clinic QR check-in configuration and staff-reviewed public queue requests. |
| 2026-07-30 | `2026-07-30_public_queue_check_in_email.sql` | Adds optional patient email capture to public QR check-in requests. |
| 2026-07-30 | `2026-07-30_sex_values_and_check_in.sql` | Standardizes new sex values to female, male, or other and adds QR check-in capture without backfilling existing rows. |
| 2026-07-30 | `2026-07-30_public_appointment_abuse_controls.sql` | Adds expiring rate-limit counters and an active appointment lookup index for public-booking abuse controls. |
| 2026-07-30 | `2026-07-30_check_in_tenant_integrity.sql` | Makes pending QR check-ins unique, adds indexed normalized patient match keys, and enforces tenant-safe check-in, follow-up, and care-program relationships. |
| 2026-07-30 | `2026-07-30_tenant_fk_delete_semantics.sql` | Preserves tenant IDs when composite nullable relationships apply their original `ON DELETE SET NULL` behavior. |
| 2026-08-02 | `2026-08-02_referral_packages.sql` | Stores immutable referral-package snapshots, generated PDF metadata, and email/WhatsApp delivery attempts. |
| 2026-08-11 | `2026-08-11_public_check_in_tracking.sql` | Adds hashed bearer tokens for privacy-preserving public QR check-in status polling. |
| 2026-08-11 | `2026-08-11_follow_up_needs_action_backfill.sql` | Restores older unanswered follow-ups with no linked appointment to the active Needs Action queue. |
| 2026-08-12 | `2026-08-12_follow_up_tracking_index.sql` | Speeds paginated follow-up views by indexing their latest reminder and invitation events. |
| 2026-08-12 | `2026-08-12_patient_directory_pagination.sql` | Adds the stable organization/visit/id index used by cursor-paginated patient directories. |
| 2026-08-13 | `2026-08-13_dashboard_revision_notifications.sql` | Publishes Postgres dashboard revision invalidations for SSE clients. |
| 2026-08-14 | `2026-08-14_whatsapp_binding_doctor_role.sql` | Allows `doctor` WhatsApp owner bindings so doctors can use the owner assistant. |
