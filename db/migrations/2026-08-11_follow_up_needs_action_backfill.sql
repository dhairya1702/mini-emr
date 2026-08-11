begin;

with restored as (
  update public.follow_ups follow_up
  set status = 'scheduled',
      completed_at = null
  where follow_up.status = 'cancelled'
    and follow_up.scheduled_for < now()
    and not exists (
      select 1
      from public.appointments appointment
      where appointment.org_id = follow_up.org_id
        and appointment.follow_up_id = follow_up.id
    )
    and not exists (
      select 1
      from public.audit_events audit_event
      where audit_event.org_id = follow_up.org_id
        and audit_event.entity_type = 'follow_up'
        and audit_event.entity_id = follow_up.id::text
        and audit_event.action = 'follow_up_backfilled_to_needs_action'
    )
  returning follow_up.id, follow_up.org_id, follow_up.patient_id, follow_up.scheduled_for
)
insert into public.audit_events (
  org_id,
  actor_user_id,
  actor_name,
  entity_type,
  entity_id,
  action,
  summary,
  metadata
)
select
  restored.org_id,
  null,
  'System Migration',
  'follow_up',
  restored.id::text,
  'follow_up_backfilled_to_needs_action',
  'Restored an older unanswered follow-up to Needs Action.',
  jsonb_build_object(
    'patient_id', restored.patient_id::text,
    'scheduled_for', restored.scheduled_for,
    'previous_status', 'cancelled',
    'restored_status', 'scheduled',
    'source', '2026-08-11_follow_up_needs_action_backfill'
  )
from restored;

commit;
