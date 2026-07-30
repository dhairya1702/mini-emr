begin;

alter table public.clinic_settings
  add column if not exists public_check_in_enabled boolean not null default false;

alter table public.clinic_settings
  add column if not exists public_check_in_token uuid not null default gen_random_uuid();

create unique index if not exists clinic_settings_public_check_in_token_uidx
  on public.clinic_settings (public_check_in_token);

create table if not exists public.public_check_in_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  submitted_name text not null,
  submitted_phone text not null,
  submitted_phone_normalized text not null,
  submitted_date_of_birth date not null,
  submitted_reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  approved_patient_id uuid references public.patients(id) on delete set null,
  reviewed_by uuid references public.clinic_users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);

create index if not exists public_check_in_requests_org_status_created_idx
  on public.public_check_in_requests (org_id, status, created_at desc);

create index if not exists public_check_in_requests_org_phone_idx
  on public.public_check_in_requests (org_id, submitted_phone_normalized);

commit;
