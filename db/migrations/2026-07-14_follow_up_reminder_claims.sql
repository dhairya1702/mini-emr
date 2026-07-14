begin;

alter table public.follow_ups
  add column if not exists reminder_claimed_at timestamptz;
alter table public.follow_ups
  add column if not exists reminder_attempt_count integer not null default 0;
alter table public.follow_ups
  add column if not exists reminder_last_error text not null default '';

create index if not exists follow_ups_due_reminder_claim_idx
  on public.follow_ups (org_id, scheduled_for, reminder_claimed_at)
  where status = 'scheduled' and reminder_sent_at is null;

commit;
