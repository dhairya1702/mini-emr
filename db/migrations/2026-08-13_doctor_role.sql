alter table public.clinic_users
  drop constraint if exists clinic_users_role_check;

alter table public.clinic_users
  add constraint clinic_users_role_check
  check (role in ('admin', 'doctor', 'staff'));
