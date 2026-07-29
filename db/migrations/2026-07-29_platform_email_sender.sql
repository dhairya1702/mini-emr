alter table public.clinic_settings
add column if not exists email_sender_mode text not null default 'clinicos';

alter table public.clinic_settings
drop constraint if exists clinic_settings_email_sender_mode_check;

alter table public.clinic_settings
add constraint clinic_settings_email_sender_mode_check
check (email_sender_mode in ('clinicos', 'clinic'));

update public.clinic_settings
set email_sender_mode = 'clinic'
where coalesce(sender_email, '') <> ''
  and coalesce(sender_email_app_password, '') <> ''
  and email_sender_mode = 'clinicos';

create table if not exists public.platform_email_settings (
  id text primary key check (id = 'default'),
  sender_name text not null default 'ClinicOS',
  sender_email text not null default '',
  sender_email_app_password text,
  is_enabled boolean not null default false,
  last_tested_at timestamptz,
  last_test_succeeded boolean not null default false,
  last_error text not null default '',
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into public.platform_email_settings (id)
values ('default')
on conflict (id) do nothing;
