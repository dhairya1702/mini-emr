begin;

create index if not exists audit_events_follow_up_tracking_idx
  on public.audit_events (org_id, entity_id, created_at desc)
  where entity_type = 'follow_up'
    and action in ('follow_up_invitation_sent', 'follow_up_reminder_sent');

commit;
