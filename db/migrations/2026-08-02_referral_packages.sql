begin;

create unique index if not exists clinic_users_org_id_id_uidx
  on public.clinic_users(org_id, id);

create table if not exists public.referral_packages (
  id uuid primary key,
  org_id uuid not null,
  patient_id uuid not null,
  created_by uuid not null,
  recipient_type text not null check (recipient_type in ('patient', 'doctor', 'both')),
  recipient_name text not null default '',
  recipient_specialty text not null default '',
  recipient_clinic text not null default '',
  recipient_email text not null default '',
  recipient_phone text not null default '',
  reason text not null,
  clinical_question text not null default '',
  urgency text not null default 'routine' check (urgency in ('routine', 'urgent', 'emergency')),
  referral_note text not null default '',
  snapshot jsonb not null,
  included_records jsonb not null default '[]'::jsonb,
  file_name text not null,
  storage_path text not null,
  file_size bigint not null check (file_size > 0),
  file_sha256 text not null,
  page_count integer not null default 0 check (page_count >= 0),
  created_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade,
  foreign key (org_id, created_by) references public.clinic_users(org_id, id)
);

create table if not exists public.referral_package_deliveries (
  id uuid primary key,
  org_id uuid not null,
  referral_package_id uuid not null,
  channel text not null check (channel in ('email', 'whatsapp')),
  recipient_type text not null check (recipient_type in ('patient', 'doctor')),
  recipient text not null,
  status text not null check (status in ('accepted', 'sent', 'delivered', 'read', 'failed')),
  provider_message_id text not null default '',
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, referral_package_id) references public.referral_packages(org_id, id) on delete cascade
);

create index if not exists referral_packages_org_patient_created_idx
  on public.referral_packages(org_id, patient_id, created_at desc);
create index if not exists referral_package_deliveries_org_package_created_idx
  on public.referral_package_deliveries(org_id, referral_package_id, created_at desc);

commit;
