alter table public.clinic_settings
drop constraint if exists clinic_settings_workspace_mode_check;

alter table public.clinic_settings
add constraint clinic_settings_workspace_mode_check
check (workspace_mode in ('solo', 'team', 'multi_doctor'));

alter table public.customer_onboarding
drop constraint if exists customer_onboarding_workspace_mode_check;

alter table public.customer_onboarding
add constraint customer_onboarding_workspace_mode_check
check (workspace_mode in ('solo', 'team', 'multi_doctor'));

alter table public.patients
add column if not exists assigned_doctor_id uuid references public.clinic_users(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'patients_assigned_doctor_org_fk'
      and conrelid = 'public.patients'::regclass
  ) then
    alter table public.patients
    add constraint patients_assigned_doctor_org_fk
    foreign key (org_id, assigned_doctor_id)
    references public.clinic_users(org_id, id)
    on delete set null (assigned_doctor_id);
  end if;
end $$;

create index if not exists patients_org_assigned_doctor_queue_idx
on public.patients (org_id, assigned_doctor_id, status, queue_priority, queue_position);
