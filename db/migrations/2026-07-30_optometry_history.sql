begin;

create table if not exists public.patient_optometry_histories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision >= 1),
  updated_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, patient_id),
  constraint patient_optometry_histories_org_patient_fk
    foreign key (org_id, patient_id)
    references public.patients(org_id, id)
    on delete cascade
);

create table if not exists public.patient_optometry_history_revisions (
  id uuid primary key default gen_random_uuid(),
  history_id uuid not null references public.patient_optometry_histories(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null,
  revision integer not null check (revision >= 1),
  payload jsonb not null,
  updated_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (history_id, revision),
  constraint patient_optometry_history_revisions_org_patient_fk
    foreign key (org_id, patient_id)
    references public.patients(org_id, id)
    on delete cascade
);

create index if not exists patient_optometry_history_revisions_patient_idx
  on public.patient_optometry_history_revisions (org_id, patient_id, revision desc);

alter table public.notes
  add column if not exists optometry_history jsonb not null default '{}'::jsonb;

alter table public.notes
  add column if not exists snapshot_optometry_history jsonb;

commit;
