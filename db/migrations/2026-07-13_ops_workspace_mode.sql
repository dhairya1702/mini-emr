begin;

alter table public.customer_onboarding
  add column if not exists workspace_mode text not null default 'solo';

update public.customer_onboarding co
set workspace_mode = cs.workspace_mode
from public.clinic_settings cs
where co.claimed_org_id = cs.org_id;

alter table public.customer_onboarding
  drop constraint if exists customer_onboarding_workspace_mode_check;

alter table public.customer_onboarding
  add constraint customer_onboarding_workspace_mode_check
  check (workspace_mode in ('solo', 'team'));

commit;
