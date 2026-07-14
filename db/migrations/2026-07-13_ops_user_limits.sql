begin;

alter table public.clinic_settings
  add column if not exists users_allowed integer not null default 2;

update public.clinic_settings cs
set users_allowed = greatest(
  cs.users_allowed,
  coalesce((
    select co.users_allowed
    from public.customer_onboarding co
    where co.claimed_org_id = cs.org_id
    limit 1
  ), 0),
  coalesce((
    select count(*)::integer
    from public.clinic_users cu
    where cu.org_id = cs.org_id
  ), 0),
  1
);

update public.customer_onboarding co
set users_allowed = cs.users_allowed,
  updated_at = now()
from public.clinic_settings cs
where co.claimed_org_id = cs.org_id
  and co.users_allowed <> cs.users_allowed;

alter table public.clinic_settings
  drop constraint if exists clinic_settings_users_allowed_check;

alter table public.clinic_settings
  add constraint clinic_settings_users_allowed_check
  check (users_allowed > 0);

commit;
