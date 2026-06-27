begin;

alter table public.clinic_users
add column if not exists session_version integer not null default 1;

commit;
