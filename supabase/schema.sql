create extension if not exists "pgcrypto";

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text not null,
  reason text not null,
  age integer,
  weight double precision,
  height double precision,
  temperature double precision,
  status text not null default 'waiting' check (status in ('waiting', 'consultation', 'done')),
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  identifier text not null unique,
  name text not null default '',
  password_hash text not null,
  role text not null check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations(id) on delete cascade,
  clinic_name text not null default 'ClinicOS',
  clinic_address text not null default '',
  clinic_phone text not null default '',
  doctor_name text not null default '',
  custom_header text not null default '',
  custom_footer text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.patients
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.notes
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.clinic_users
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.clinic_users
add column if not exists name text not null default '';

alter table public.clinic_settings
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

create unique index if not exists clinic_settings_org_id_key on public.clinic_settings (org_id);
create index if not exists patients_org_status_idx on public.patients (org_id, status, created_at desc);
create index if not exists notes_org_patient_id_idx on public.notes (org_id, patient_id, created_at desc);
create index if not exists clinic_users_org_role_idx on public.clinic_users (org_id, role, created_at desc);
