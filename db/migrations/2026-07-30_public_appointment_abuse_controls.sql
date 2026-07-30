begin;

alter table public.api_rate_limits
  add column if not exists expires_at timestamptz;

update public.api_rate_limits
set expires_at = updated_at + interval '5 minutes'
where expires_at is null;

alter table public.api_rate_limits
  alter column expires_at set default (now() + interval '5 minutes');

alter table public.api_rate_limits
  alter column expires_at set not null;

create index if not exists api_rate_limits_expires_at_idx
  on public.api_rate_limits (expires_at);

create index if not exists appointments_org_phone_scheduled_idx
  on public.appointments (org_id, phone, scheduled_for desc)
  where status = 'scheduled';

commit;
