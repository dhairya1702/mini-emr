begin;

alter table public.catalog_items drop constraint if exists catalog_items_item_type_check;
alter table public.catalog_items add constraint catalog_items_item_type_check
  check (item_type in ('service', 'medicine', 'program'));
alter table public.catalog_items
  add column if not exists description text not null default '',
  add column if not exists program_key text,
  add column if not exists program_definition jsonb,
  add column if not exists is_active boolean not null default true;
alter table public.catalog_items drop constraint if exists catalog_items_program_shape_check;
alter table public.catalog_items add constraint catalog_items_program_shape_check check (
  (item_type = 'program' and program_key is not null and program_definition is not null and track_inventory = false)
  or (item_type <> 'program' and program_key is null and program_definition is null)
);
create unique index if not exists catalog_items_org_program_key_uidx
  on public.catalog_items(org_id, program_key) where program_key is not null;

alter table public.invoice_items drop constraint if exists invoice_items_item_type_check;
alter table public.invoice_items add constraint invoice_items_item_type_check
  check (item_type in ('service', 'medicine', 'program'));

create table if not exists public.patient_program_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id) on delete restrict,
  originating_invoice_id uuid not null references public.invoices(id) on delete restrict,
  originating_invoice_item_id uuid not null unique references public.invoice_items(id) on delete restrict,
  responsible_user_id uuid references public.clinic_users(id) on delete set null,
  status text not null check (status in ('pending', 'active', 'completed', 'cancelled')),
  agreed_price numeric(14,2) not null default 0,
  program_snapshot jsonb not null,
  started_at timestamptz,
  ends_at timestamptz,
  next_action_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists patient_program_enrollments_one_current_uidx
  on public.patient_program_enrollments(org_id, patient_id, catalog_item_id)
  where status in ('pending', 'active');
create index if not exists patient_program_enrollments_org_status_next_idx
  on public.patient_program_enrollments(org_id, status, next_action_at);

create table if not exists public.care_program_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null references public.patient_program_enrollments(id) on delete cascade,
  event_type text not null,
  sequence integer,
  status text not null check (status in ('scheduled', 'completed', 'cancelled')),
  title text not null,
  due_at timestamptz,
  completed_at timestamptz,
  source_event_id uuid references public.care_program_events(id) on delete set null,
  linked_entity_type text,
  linked_entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists care_program_events_review_sequence_uidx
  on public.care_program_events(enrollment_id, event_type, sequence)
  where event_type = 'review';
create index if not exists care_program_events_org_due_idx
  on public.care_program_events(org_id, status, due_at);

commit;
