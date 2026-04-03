create extension if not exists "pgcrypto";

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
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
  patient_id uuid not null references public.patients(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists patients_status_idx on public.patients (status, created_at desc);
create index if not exists notes_patient_id_idx on public.notes (patient_id, created_at desc);
