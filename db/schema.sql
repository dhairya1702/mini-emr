-- Cloud SQL PostgreSQL-compatible schema.

create extension if not exists "pgcrypto";

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.schema_migrations (
  migration_name text primary key,
  checksum_sha256 text not null,
  applied_at timestamptz not null default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text not null,
  email text not null default '',
  address text not null default '',
  reason text not null,
  date_of_birth date,
  sex_at_birth text check (sex_at_birth in ('female', 'male', 'other')),
  gender_identity text not null default '',
  age integer,
  weight double precision,
  height double precision,
  temperature double precision,
  profile_photo_storage_path text,
  profile_photo_content_type text,
  profile_photo_updated_at timestamptz,
  status text not null default 'waiting' check (status in ('waiting', 'consultation', 'done')),
  billed boolean not null default false,
  queue_priority text not null default 'normal' check (queue_priority in ('normal', 'urgent')),
  stage_entered_at timestamptz not null default now(),
  queue_position bigint not null default 0,
  current_visit_id uuid,
  ai_summary text not null default '',
  ai_summary_updated_at timestamptz,
  ai_summary_stale boolean not null default true,
  ai_summary_revision integer not null default 0,
  ai_summary_source_hash text,
  created_at timestamptz not null default now(),
  last_visit_at timestamptz not null default now()
);

create table if not exists public.clinic_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  identifier text not null unique,
  name text not null default '',
  doctor_dob date,
  doctor_address text not null default '',
  doctor_signature_name text,
  doctor_signature_content_type text,
  doctor_signature_data_base64 text,
  updated_at timestamptz not null default now(),
  password_hash text not null,
  session_version integer not null default 1,
  superdashboard_session_version integer not null default 1,
  role text not null check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid,
  content text not null,
  status text not null default 'draft' check (status in ('draft', 'final', 'sent')),
  version_number integer not null default 1,
  root_note_id uuid references public.notes(id) on delete set null,
  amended_from_note_id uuid references public.notes(id) on delete set null,
  snapshot_content text,
  asset_payload jsonb not null default '[]'::jsonb,
  snapshot_asset_payload jsonb not null default '[]'::jsonb,
  structured_modules jsonb not null default '[]'::jsonb,
  clinical_extractions jsonb not null default '{"services_performed":[],"medications_prescribed":[]}'::jsonb,
  snapshot_clinical_extractions jsonb,
  finalized_at timestamptz,
  sent_at timestamptz,
  sent_by uuid references public.clinic_users(id) on delete set null,
  sent_to text,
  created_at timestamptz not null default now()
);

create table if not exists public.patient_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  uploaded_by uuid references public.clinic_users(id) on delete set null,
  file_name text not null,
  content_type text not null,
  file_size bigint not null default 0,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique references public.organizations(id) on delete cascade,
  clinic_name text not null default 'ClinicOS',
  clinic_address text not null default '',
  clinic_phone text not null default '',
  clinic_specialty text check (clinic_specialty in ('optometry', 'general_physician', 'pediatrics', 'dentistry')),
  timezone text not null default 'Asia/Kolkata',
  appointment_start_time text not null default '09:00',
  appointment_end_time text not null default '18:00',
  appointments_per_hour integer not null default 4,
  doctor_name text not null default '',
  sender_name text not null default '',
  sender_email text not null default '',
  sender_email_app_password text,
  email_sender_mode text not null default 'clinicos' check (email_sender_mode in ('clinicos', 'clinic')),
  custom_header text not null default '',
  custom_footer text not null default '',
  document_template_name text,
  document_template_url text,
  document_template_content_type text,
  document_template_data_base64 text,
  document_template_notes_enabled boolean not null default false,
  document_template_letters_enabled boolean not null default false,
  document_template_invoices_enabled boolean not null default false,
  document_template_margin_top double precision not null default 54,
  document_template_margin_right double precision not null default 54,
  document_template_margin_bottom double precision not null default 54,
  document_template_margin_left double precision not null default 54,
  document_template_signature_x double precision not null default 0.1,
  document_template_signature_y double precision not null default 0.78,
  document_template_signature_width double precision not null default 0.24,
  document_template_signature_height double precision not null default 0.08,
  document_template_doctor_name_x double precision not null default 0.1,
  document_template_doctor_name_y double precision not null default 0.87,
  document_template_doctor_name_width double precision not null default 0.24,
  document_template_doctor_name_height double precision not null default 0.04,
  document_template_note_layout jsonb not null default '{}'::jsonb,
  onboarding_required boolean not null default false,
  onboarding_completed_at timestamptz,
  users_allowed integer not null default 2 check (users_allowed > 0),
  workspace_mode text not null default 'solo' check (workspace_mode in ('solo', 'team')),
  public_check_in_enabled boolean not null default false,
  public_check_in_token uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);

create unique index if not exists clinic_settings_public_check_in_token_uidx
  on public.clinic_settings (public_check_in_token);

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

create table if not exists public.customer_onboarding (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null unique,
  customer_name text not null,
  phone text not null,
  users_allowed integer not null default 2 check (users_allowed > 0),
  workspace_mode text not null default 'solo' check (workspace_mode in ('solo', 'team')),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'disabled')),
  claimed_org_id uuid references public.organizations(id) on delete set null,
  claimed_at timestamptz,
  created_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_onboarding_phone_idx
  on public.customer_onboarding(phone);

create index if not exists customer_onboarding_status_idx
  on public.customer_onboarding(status);

create index if not exists customer_onboarding_claimed_org_id_idx
  on public.customer_onboarding(claimed_org_id);

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  item_type text not null check (item_type in ('service', 'medicine', 'program')),
  description text not null default '',
  program_key text,
  program_definition jsonb,
  is_active boolean not null default true,
  default_price numeric(14,2) not null default 0,
  track_inventory boolean not null default false,
  stock_quantity numeric(14,3) not null default 0,
  low_stock_threshold numeric(14,3) not null default 0,
  unit text not null default '',
  aliases jsonb not null default '[]'::jsonb check (jsonb_typeof(aliases) = 'array'),
  constraint catalog_items_program_shape_check check (
    (item_type = 'program' and program_key is not null and program_definition is not null and track_inventory = false)
    or (item_type <> 'program' and program_key is null and program_definition is null)
  ),
  created_at timestamptz not null default now()
);

create unique index if not exists catalog_items_org_program_key_uidx
  on public.catalog_items(org_id, program_key)
  where program_key is not null;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid,
  subtotal numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'partial')),
  amount_paid numeric(14,2) not null default 0,
  paid_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.clinic_users(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  catalog_item_id uuid references public.catalog_items(id) on delete set null,
  item_type text not null check (item_type in ('service', 'medicine', 'program')),
  label text not null,
  quantity numeric(14,3) not null,
  unit_price numeric(14,2) not null,
  line_total numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.clinic_users(id) on delete set null,
  actor_name text not null default '',
  entity_type text not null,
  entity_id text not null,
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  model text not null,
  feature text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  total_tokens integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.api_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

create table if not exists public.public_check_in_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  submitted_name text not null,
  submitted_phone text not null,
  submitted_phone_normalized text not null,
  submitted_email text not null default '',
  submitted_date_of_birth date not null,
  submitted_sex_at_birth text not null
    check (submitted_sex_at_birth in ('female', 'male', 'other')),
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

create index if not exists public_check_in_requests_org_email_idx
  on public.public_check_in_requests (org_id, lower(submitted_email))
  where submitted_email <> '';

create index if not exists api_rate_limits_updated_at_idx
  on public.api_rate_limits(updated_at);

create table if not exists public.api_request_metrics (
  metric_date date not null,
  org_id uuid not null,
  request_count bigint not null default 0 check (request_count >= 0),
  error_response_count bigint not null default 0 check (error_response_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (metric_date, org_id)
);

create index if not exists api_request_metrics_metric_date_idx
  on public.api_request_metrics(metric_date desc);

create index if not exists ai_usage_events_org_id_created_at_idx
  on public.ai_usage_events(org_id, created_at desc);

create table if not exists public.platform_errors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  user_id uuid references public.clinic_users(id) on delete set null,
  identifier text not null default '',
  path text not null,
  method text not null,
  status_code integer,
  error_type text not null,
  message text not null,
  details text not null default '',
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_errors_created_at_idx
  on public.platform_errors(created_at desc);

create index if not exists platform_errors_org_id_created_at_idx
  on public.platform_errors(org_id, created_at desc);

create table if not exists public.whatsapp_owner_bindings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.clinic_users(id) on delete set null,
  wa_id text not null,
  phone text not null default '',
  display_name text not null default '',
  role text not null default 'owner' check (role in ('admin', 'owner', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists whatsapp_owner_bindings_active_wa_id_idx
  on public.whatsapp_owner_bindings (wa_id)
  where is_active;

create index if not exists whatsapp_owner_bindings_org_id_idx
  on public.whatsapp_owner_bindings (org_id);

create table if not exists public.whatsapp_message_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  binding_id uuid references public.whatsapp_owner_bindings(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  wa_message_id text not null default '',
  sender_wa_id text not null default '',
  recipient_wa_id text not null default '',
  message_text text not null default '',
  intent text not null default '',
  status text not null check (status in ('received', 'ignored', 'queued', 'sent', 'accepted', 'delivered', 'read', 'failed')),
  error text not null default '',
  raw_payload jsonb not null default '{}'::jsonb,
  document_type text not null default '',
  document_id text not null default '',
  idempotency_key text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists whatsapp_message_events_org_created_idx
  on public.whatsapp_message_events (org_id, created_at desc);

create index if not exists whatsapp_message_events_wa_message_id_idx
  on public.whatsapp_message_events (wa_message_id);

create unique index if not exists whatsapp_message_events_org_idempotency_uidx
  on public.whatsapp_message_events (org_id, idempotency_key)
  where org_id is not null and idempotency_key <> '';

create index if not exists whatsapp_message_events_org_document_idx
  on public.whatsapp_message_events (org_id, document_type, document_id, created_at desc)
  where document_type <> '' and document_id <> '';

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_by uuid references public.clinic_users(id) on delete set null,
  scheduled_for timestamptz not null,
  notes text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  completed_at timestamptz,
  reminder_sent_at timestamptz,
  reminder_claimed_at timestamptz,
  reminder_attempt_count integer not null default 0,
  reminder_last_error text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text not null,
  email text not null default '',
  address text not null default '',
  reason text not null,
  date_of_birth date,
  sex_at_birth text check (sex_at_birth in ('female', 'male', 'other')),
  gender_identity text not null default '',
  age integer,
  weight double precision,
  height double precision,
  temperature double precision,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'checked_in', 'cancelled')),
  follow_up_id uuid references public.follow_ups(id) on delete set null,
  checked_in_patient_id uuid references public.patients(id) on delete set null,
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.patient_visits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  name text not null,
  phone text not null,
  email text not null default '',
  address text not null default '',
  reason text not null,
  date_of_birth date,
  sex_at_birth text check (sex_at_birth in ('female', 'male', 'other')),
  gender_identity text not null default '',
  age integer,
  weight double precision,
  height double precision,
  temperature double precision,
  source text not null default 'queue' check (source in ('queue', 'appointment')),
  appointment_id uuid references public.appointments(id) on delete set null,
  follow_up_id uuid references public.follow_ups(id) on delete set null,
  visit_kind text not null default 'new' check (visit_kind in ('new', 'follow_up')),
  created_at timestamptz not null default now()
);

alter table public.patients
  drop constraint if exists patients_current_visit_id_fkey;
alter table public.patients
  add constraint patients_current_visit_id_fkey
  foreign key (current_visit_id) references public.patient_visits(id) on delete set null;

alter table public.invoices
  drop constraint if exists invoices_visit_id_fkey;
alter table public.invoices
  add constraint invoices_visit_id_fkey
  foreign key (visit_id) references public.patient_visits(id) on delete set null;

create index if not exists patients_current_visit_idx on public.patients (org_id, current_visit_id);
create index if not exists invoices_visit_created_idx on public.invoices (org_id, visit_id, created_at desc);

create table if not exists public.myopia_measurements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  measured_at timestamptz not null,
  age_years double precision not null,
  axial_length_right_mm double precision not null,
  axial_length_left_mm double precision not null,
  treatment_type text not null default '',
  treatment_notes text not null default '',
  visit_notes text not null default '',
  refraction_right text not null default '',
  refraction_left text not null default '',
  created_at timestamptz not null default now()
);

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

create table if not exists public.longitudinal_tracks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  track_type text not null,
  measured_at timestamptz not null,
  summary_fields jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  derived_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists longitudinal_tracks_org_patient_measured_at_idx
  on public.longitudinal_tracks(org_id, patient_id, measured_at asc);

create index if not exists myopia_measurements_patient_measured_at_idx
  on public.myopia_measurements(patient_id, measured_at asc);

create index if not exists myopia_measurements_org_patient_measured_at_idx
  on public.myopia_measurements(org_id, patient_id, measured_at asc);

create table if not exists public.case_studies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  title text not null,
  status text not null default 'draft' check (status in ('draft', 'final')),
  template_key text not null check (template_key in ('conference_presentation', 'teaching_rounds', 'hospital_case_discussion')),
  anonymized boolean not null default true,
  author_instructions text not null default '',
  generated_content text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists case_studies_org_created_at_idx
  on public.case_studies(org_id, created_at desc);

create index if not exists case_studies_org_patient_updated_at_idx
  on public.case_studies(org_id, patient_id, updated_at desc);

-- Composite tenant keys prevent a child row from pairing one organization with
-- a patient or parent record owned by another organization.
create unique index if not exists patients_org_id_id_uidx
  on public.patients(org_id, id);
create unique index if not exists clinic_users_org_id_id_uidx
  on public.clinic_users(org_id, id);
create unique index if not exists catalog_items_org_id_id_uidx
  on public.catalog_items(org_id, id);
create unique index if not exists invoices_org_id_id_uidx
  on public.invoices(org_id, id);
create unique index if not exists notes_org_id_id_uidx
  on public.notes(org_id, id);
create unique index if not exists appointments_org_id_id_uidx
  on public.appointments(org_id, id);
create unique index if not exists patient_visits_org_id_id_uidx
  on public.patient_visits(org_id, id);
create unique index if not exists whatsapp_owner_bindings_org_id_id_uidx
  on public.whatsapp_owner_bindings(org_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_org_patient_fk') then
    alter table public.notes add constraint notes_org_patient_fk foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_org_root_fk') then
    alter table public.notes add constraint notes_org_root_fk foreign key (org_id, root_note_id) references public.notes(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_org_amended_from_fk') then
    alter table public.notes add constraint notes_org_amended_from_fk foreign key (org_id, amended_from_note_id) references public.notes(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_org_visit_fk') then
    alter table public.notes add constraint notes_org_visit_fk foreign key (org_id, visit_id) references public.patient_visits(org_id, id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_attachments_org_patient_fk') then
    alter table public.patient_attachments add constraint patient_attachments_org_patient_fk foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_org_patient_fk') then
    alter table public.invoices add constraint invoices_org_patient_fk foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_org_completed_by_fk') then
    alter table public.invoices add constraint invoices_org_completed_by_fk foreign key (org_id, completed_by) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_org_invoice_fk') then
    alter table public.invoice_items add constraint invoice_items_org_invoice_fk foreign key (org_id, invoice_id) references public.invoices(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_org_catalog_item_fk') then
    alter table public.invoice_items add constraint invoice_items_org_catalog_item_fk foreign key (org_id, catalog_item_id) references public.catalog_items(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_org_sent_by_fk') then
    alter table public.notes add constraint notes_org_sent_by_fk foreign key (org_id, sent_by) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_attachments_org_uploaded_by_fk') then
    alter table public.patient_attachments add constraint patient_attachments_org_uploaded_by_fk foreign key (org_id, uploaded_by) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'audit_events_org_actor_user_fk') then
    alter table public.audit_events add constraint audit_events_org_actor_user_fk foreign key (org_id, actor_user_id) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'platform_errors_org_user_fk') then
    alter table public.platform_errors add constraint platform_errors_org_user_fk foreign key (org_id, user_id) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_owner_bindings_org_user_fk') then
    alter table public.whatsapp_owner_bindings add constraint whatsapp_owner_bindings_org_user_fk foreign key (org_id, user_id) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_message_events_org_binding_fk') then
    alter table public.whatsapp_message_events add constraint whatsapp_message_events_org_binding_fk foreign key (org_id, binding_id) references public.whatsapp_owner_bindings(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_org_patient_fk') then
    alter table public.follow_ups add constraint follow_ups_org_patient_fk foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_org_created_by_fk') then
    alter table public.follow_ups add constraint follow_ups_org_created_by_fk foreign key (org_id, created_by) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_org_checked_in_patient_fk') then
    alter table public.appointments add constraint appointments_org_checked_in_patient_fk foreign key (org_id, checked_in_patient_id) references public.patients(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_visits_org_patient_fk') then
    alter table public.patient_visits add constraint patient_visits_org_patient_fk foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_visits_org_appointment_fk') then
    alter table public.patient_visits add constraint patient_visits_org_appointment_fk foreign key (org_id, appointment_id) references public.appointments(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'myopia_measurements_org_patient_fk') then
    alter table public.myopia_measurements add constraint myopia_measurements_org_patient_fk foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'longitudinal_tracks_org_patient_fk') then
    alter table public.longitudinal_tracks add constraint longitudinal_tracks_org_patient_fk foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'case_studies_org_patient_fk') then
    alter table public.case_studies add constraint case_studies_org_patient_fk foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'case_studies_org_created_by_fk') then
    alter table public.case_studies add constraint case_studies_org_created_by_fk foreign key (org_id, created_by) references public.clinic_users(org_id, id);
  end if;
end
$$;

alter table public.patients
add column if not exists date_of_birth date;

alter table public.patients
add column if not exists profile_photo_storage_path text;

alter table public.patients
add column if not exists profile_photo_content_type text;

alter table public.patients
add column if not exists profile_photo_updated_at timestamptz;

alter table public.patient_visits
add column if not exists date_of_birth date;

alter table public.appointments
add column if not exists date_of_birth date;

alter table public.patients
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.patients
add column if not exists billed boolean not null default false;

alter table public.patients
add column if not exists queue_priority text not null default 'normal';

alter table public.patients
add column if not exists stage_entered_at timestamptz not null default now();

alter table public.patients
add column if not exists queue_position bigint not null default 0;

alter table public.patients
drop constraint if exists patients_queue_priority_check;

alter table public.patients
add constraint patients_queue_priority_check
check (queue_priority in ('normal', 'urgent'));

update public.patients
set stage_entered_at = last_visit_at
where status = 'waiting';

with ranked as (
  select id,
    row_number() over (
      partition by org_id, status
      order by case when queue_priority = 'urgent' then 0 else 1 end, last_visit_at desc, id
    ) as next_position
  from public.patients
)
update public.patients p
set queue_position = ranked.next_position
from ranked
where ranked.id = p.id
  and p.queue_position = 0;

create index if not exists patients_org_queue_order_idx
on public.patients (org_id, status, queue_priority, queue_position);

create or replace function public.set_patient_queue_metadata()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.org_id::text));
  if tg_op = 'INSERT' then
    new.queue_priority := coalesce(new.queue_priority, 'normal');
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
    if coalesce(new.queue_position, 0) <= 0 then
      select coalesce(max(queue_position), 0) + 1 into new.queue_position
      from public.patients where org_id = new.org_id and status = new.status;
    end if;
  elsif new.status is distinct from old.status then
    new.stage_entered_at := now();
    if new.queue_position = old.queue_position then
      select coalesce(max(queue_position), 0) + 1 into new.queue_position
      from public.patients where org_id = new.org_id and status = new.status and id <> new.id;
    end if;
  elsif new.status = 'waiting' and new.last_visit_at is distinct from old.last_visit_at then
    new.queue_priority := 'normal';
    new.stage_entered_at := now();
    if new.queue_position = old.queue_position then
      select coalesce(max(queue_position), 0) + 1 into new.queue_position
      from public.patients where org_id = new.org_id and status = 'waiting' and id <> new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists patients_queue_metadata_trigger on public.patients;
create trigger patients_queue_metadata_trigger
before insert or update of status, last_visit_at on public.patients
for each row execute function public.set_patient_queue_metadata();

alter table public.patients
add column if not exists last_visit_at timestamptz not null default now();

alter table public.patients
add column if not exists email text not null default '';

alter table public.patients
add column if not exists address text not null default '';

alter table public.patients
add column if not exists ai_summary text not null default '';

alter table public.patients
add column if not exists ai_summary_updated_at timestamptz;

alter table public.patients
add column if not exists ai_summary_stale boolean not null default true;

alter table public.patients
add column if not exists ai_summary_revision integer not null default 0;

alter table public.patients
add column if not exists ai_summary_source_hash text;

update public.patients
set last_visit_at = created_at
where last_visit_at is null;

alter table public.notes
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.notes
add column if not exists visit_id uuid;

alter table public.notes
add column if not exists sent_at timestamptz;

alter table public.notes
add column if not exists status text not null default 'draft';

alter table public.notes
add column if not exists version_number integer not null default 1;

alter table public.notes
add column if not exists root_note_id uuid references public.notes(id) on delete set null;

alter table public.notes
add column if not exists amended_from_note_id uuid references public.notes(id) on delete set null;

alter table public.notes
add column if not exists snapshot_content text;

alter table public.notes
add column if not exists asset_payload jsonb not null default '[]'::jsonb;

alter table public.notes
add column if not exists snapshot_asset_payload jsonb not null default '[]'::jsonb;

alter table public.notes
add column if not exists finalized_at timestamptz;

alter table public.notes
add column if not exists sent_by uuid references public.clinic_users(id) on delete set null;

alter table public.notes
add column if not exists sent_to text;

alter table public.clinic_users
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.follow_ups
add column if not exists reminder_sent_at timestamptz;

alter table public.clinic_users
add column if not exists name text not null default '';

alter table public.clinic_users
add column if not exists session_version integer not null default 1;

alter table public.clinic_users
add column if not exists doctor_dob date;

alter table public.clinic_users
add column if not exists doctor_address text not null default '';

alter table public.clinic_users
add column if not exists doctor_signature_name text;

alter table public.clinic_users
add column if not exists doctor_signature_content_type text;

alter table public.clinic_users
add column if not exists doctor_signature_data_base64 text;

alter table public.clinic_users
add column if not exists updated_at timestamptz not null default now();

alter table public.clinic_settings
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.clinic_settings
add column if not exists sender_name text not null default '';

alter table public.clinic_settings
add column if not exists clinic_specialty text;

alter table public.notes
add column if not exists structured_modules jsonb not null default '[]'::jsonb;

alter table public.clinic_settings
drop constraint if exists clinic_settings_clinic_specialty_check;

alter table public.clinic_settings
add constraint clinic_settings_clinic_specialty_check
check (clinic_specialty in ('optometry', 'general_physician', 'pediatrics', 'dentistry'));

alter table public.clinic_settings
add column if not exists appointment_start_time text not null default '09:00';

alter table public.clinic_settings
add column if not exists timezone text not null default 'Asia/Kolkata';

alter table public.clinic_settings
add column if not exists appointment_end_time text not null default '18:00';

alter table public.clinic_settings
add column if not exists appointments_per_hour integer not null default 4;

alter table public.clinic_settings
add column if not exists sender_email text not null default '';

alter table public.clinic_settings
add column if not exists sender_email_app_password text;

alter table public.clinic_settings
add column if not exists document_template_name text;

alter table public.clinic_settings
add column if not exists document_template_url text;

alter table public.clinic_settings
add column if not exists document_template_content_type text;

alter table public.clinic_settings
add column if not exists document_template_data_base64 text;

alter table public.clinic_settings
add column if not exists document_template_notes_enabled boolean not null default false;

alter table public.clinic_settings
add column if not exists document_template_letters_enabled boolean not null default false;

alter table public.clinic_settings
add column if not exists document_template_invoices_enabled boolean not null default false;

alter table public.clinic_settings
add column if not exists document_template_margin_top double precision not null default 54;

alter table public.clinic_settings
add column if not exists document_template_margin_right double precision not null default 54;

alter table public.clinic_settings
add column if not exists document_template_margin_bottom double precision not null default 54;

alter table public.clinic_settings
add column if not exists document_template_margin_left double precision not null default 54;

alter table public.clinic_settings
add column if not exists onboarding_required boolean not null default false;

alter table public.clinic_settings
add column if not exists onboarding_completed_at timestamptz;

alter table public.clinic_settings
add column if not exists users_allowed integer not null default 2;

update public.clinic_settings cs
set users_allowed = greatest(
  cs.users_allowed,
  coalesce((
    select co.users_allowed
    from public.customer_onboarding co
    where co.claimed_org_id = cs.org_id
    limit 1
  ), 0),
  coalesce((
    select count(*)::integer
    from public.clinic_users cu
    where cu.org_id = cs.org_id
  ), 0),
  1
);

update public.customer_onboarding co
set users_allowed = cs.users_allowed,
  updated_at = now()
from public.clinic_settings cs
where co.claimed_org_id = cs.org_id
and co.users_allowed <> cs.users_allowed;

alter table public.clinic_settings
drop constraint if exists clinic_settings_users_allowed_check;

alter table public.clinic_settings
add constraint clinic_settings_users_allowed_check
check (users_allowed > 0);

alter table public.clinic_settings
add column if not exists workspace_mode text not null default 'solo';

alter table public.clinic_settings
drop constraint if exists clinic_settings_workspace_mode_check;

alter table public.clinic_settings
add constraint clinic_settings_workspace_mode_check
check (workspace_mode in ('solo', 'team'));

alter table public.customer_onboarding
add column if not exists workspace_mode text not null default 'solo';

update public.customer_onboarding co
set workspace_mode = cs.workspace_mode
from public.clinic_settings cs
where co.claimed_org_id = cs.org_id;

alter table public.customer_onboarding
drop constraint if exists customer_onboarding_workspace_mode_check;

alter table public.customer_onboarding
add constraint customer_onboarding_workspace_mode_check
check (workspace_mode in ('solo', 'team'));

alter table public.catalog_items
add column if not exists track_inventory boolean not null default false;

alter table public.ai_usage_events
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.ai_usage_events
add column if not exists provider text not null default 'gemini';

alter table public.ai_usage_events
add column if not exists model text not null default '';

alter table public.ai_usage_events
add column if not exists feature text not null default '';

alter table public.ai_usage_events
add column if not exists input_tokens integer not null default 0;

alter table public.ai_usage_events
add column if not exists output_tokens integer not null default 0;

alter table public.ai_usage_events
add column if not exists cache_creation_input_tokens integer not null default 0;

alter table public.ai_usage_events
add column if not exists cache_read_input_tokens integer not null default 0;

alter table public.ai_usage_events
add column if not exists total_tokens integer not null default 0;

alter table public.ai_usage_events
add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.catalog_items
add column if not exists stock_quantity double precision not null default 0;

alter table public.catalog_items
add column if not exists low_stock_threshold double precision not null default 0;

alter table public.invoices
add column if not exists sent_at timestamptz;

alter table public.invoices
add column if not exists paid_at timestamptz;

alter table public.invoices
add column if not exists amount_paid double precision not null default 0;

alter table public.invoices
add column if not exists completed_at timestamptz;

alter table public.invoices
add column if not exists completed_by uuid references public.clinic_users(id) on delete set null;

alter table public.invoice_items
add column if not exists catalog_item_id uuid references public.catalog_items(id) on delete set null;

alter table public.invoice_items
add column if not exists org_id uuid;

alter table public.follow_ups
add column if not exists created_by uuid references public.clinic_users(id) on delete set null;

alter table public.follow_ups
add column if not exists notes text not null default '';

alter table public.follow_ups
add column if not exists status text not null default 'scheduled';

alter table public.follow_ups
add column if not exists completed_at timestamptz;

alter table public.appointments
add column if not exists checked_in_patient_id uuid references public.patients(id) on delete set null;

alter table public.appointments
add column if not exists checked_in_at timestamptz;

alter table public.appointments
add column if not exists email text not null default '';

alter table public.appointments
add column if not exists address text not null default '';

alter table public.patient_visits
add column if not exists email text not null default '';

alter table public.patient_visits
add column if not exists address text not null default '';

create unique index if not exists clinic_settings_org_id_key on public.clinic_settings (org_id);
create index if not exists patients_org_status_idx on public.patients (org_id, status, created_at desc);
create index if not exists patients_org_last_visit_idx on public.patients (org_id, last_visit_at desc);
create index if not exists patients_org_phone_last_visit_idx on public.patients (org_id, phone, last_visit_at desc);
create index if not exists patient_visits_patient_created_idx on public.patient_visits (patient_id, created_at desc);
create index if not exists patient_visits_org_created_idx on public.patient_visits (org_id, created_at desc);
create index if not exists patient_visits_org_patient_created_idx on public.patient_visits (org_id, patient_id, created_at desc);
create index if not exists notes_org_patient_id_idx on public.notes (org_id, patient_id, created_at desc);
create index if not exists clinic_users_org_role_idx on public.clinic_users (org_id, role, created_at desc);
create index if not exists catalog_items_org_type_idx on public.catalog_items (org_id, item_type, name);

alter table public.notes
  add column if not exists clinical_extractions jsonb not null
    default '{"services_performed":[],"medications_prescribed":[]}'::jsonb,
  add column if not exists snapshot_clinical_extractions jsonb;

alter table public.catalog_items
  add column if not exists aliases jsonb not null default '[]'::jsonb;
create index if not exists invoices_org_patient_idx on public.invoices (org_id, patient_id, created_at desc);
create index if not exists invoices_org_created_idx on public.invoices (org_id, created_at desc);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id, created_at asc);
create index if not exists invoice_items_org_invoice_idx on public.invoice_items (org_id, invoice_id, created_at asc);
create index if not exists invoice_items_org_catalog_item_idx on public.invoice_items (org_id, catalog_item_id)
  where catalog_item_id is not null;
create index if not exists audit_events_org_created_idx on public.audit_events (org_id, created_at desc);
create index if not exists follow_ups_org_status_scheduled_idx on public.follow_ups (org_id, status, scheduled_for asc);
create index if not exists follow_ups_patient_idx on public.follow_ups (patient_id, created_at desc);
create index if not exists follow_ups_org_patient_scheduled_idx on public.follow_ups (org_id, patient_id, scheduled_for desc);
create index if not exists follow_ups_due_reminder_idx on public.follow_ups (org_id, scheduled_for asc)
  where status = 'scheduled' and reminder_sent_at is null;
create index if not exists follow_ups_due_reminder_claim_idx on public.follow_ups (org_id, scheduled_for, reminder_claimed_at)
  where status = 'scheduled' and reminder_sent_at is null;
create index if not exists appointments_org_status_scheduled_idx on public.appointments (org_id, status, scheduled_for asc);
create index if not exists appointments_org_checked_in_patient_created_idx on public.appointments (org_id, checked_in_patient_id, created_at desc);
create index if not exists appointments_org_follow_up_idx on public.appointments (org_id, follow_up_id);
create index if not exists patient_visits_org_follow_up_idx on public.patient_visits (org_id, follow_up_id);
create index if not exists notes_org_visit_created_idx on public.notes(org_id, visit_id, created_at desc);

drop function if exists public.check_in_appointment_atomic(uuid, uuid);
drop function if exists public.check_in_appointment_atomic(uuid, uuid, boolean, uuid);

create or replace function public.check_in_appointment_atomic(
  p_org_id uuid,
  p_appointment_id uuid,
  p_existing_patient_id uuid default null
) returns jsonb
language plpgsql
as $$
declare
  v_appointment public.appointments%rowtype;
  v_patient public.patients%rowtype;
  v_visit public.patient_visits%rowtype;
  v_visit_kind text;
begin
  select *
  into v_appointment
  from public.appointments
  where id = p_appointment_id
    and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Appointment not found for this organization.';
  end if;

  if v_appointment.status <> 'scheduled' then
    raise exception 'Only scheduled appointments can be added to the waiting queue.';
  end if;

  v_visit_kind := case when v_appointment.follow_up_id is not null then 'follow_up' else 'new' end;

  if p_existing_patient_id is not null then
    select *
    into v_patient
    from public.patients
    where id = p_existing_patient_id
      and org_id = p_org_id
    for update;

    if not found then
      raise exception 'Selected patient not found for this organization.';
    end if;

    if v_patient.billed then
      raise exception 'Only active queue patients can be linked to this appointment.';
    end if;

    update public.patients
    set
      name = v_appointment.name,
      phone = v_appointment.phone,
      email = v_appointment.email,
      address = v_appointment.address,
      reason = v_appointment.reason,
      date_of_birth = v_appointment.date_of_birth,
      sex_at_birth = v_appointment.sex_at_birth,
      gender_identity = v_appointment.gender_identity,
      age = v_appointment.age,
      weight = v_appointment.weight,
      height = v_appointment.height,
      temperature = v_appointment.temperature,
      status = 'waiting',
      billed = false,
      last_visit_at = now()
    where id = v_patient.id
    returning * into v_patient;
  else
    insert into public.patients (
      org_id,
      name,
      phone,
      email,
      address,
      reason,
      date_of_birth,
      sex_at_birth,
      gender_identity,
      age,
      weight,
      height,
      temperature,
      status,
      billed,
      last_visit_at
    )
    values (
      p_org_id,
      v_appointment.name,
      v_appointment.phone,
      v_appointment.email,
      v_appointment.address,
      v_appointment.reason,
      v_appointment.date_of_birth,
      v_appointment.sex_at_birth,
      v_appointment.gender_identity,
      v_appointment.age,
      v_appointment.weight,
      v_appointment.height,
      v_appointment.temperature,
      'waiting',
      false,
      now()
    )
    returning * into v_patient;
  end if;

  insert into public.patient_visits (
    org_id,
    patient_id,
    name,
    phone,
    email,
    address,
    reason,
    date_of_birth,
    sex_at_birth,
    gender_identity,
    age,
    weight,
    height,
    temperature,
    source,
    appointment_id,
    follow_up_id,
    visit_kind
  )
  values (
    p_org_id,
    v_patient.id,
    v_appointment.name,
    v_appointment.phone,
    v_appointment.email,
    v_appointment.address,
    v_appointment.reason,
    v_appointment.date_of_birth,
    v_appointment.sex_at_birth,
    v_appointment.gender_identity,
    v_appointment.age,
    v_appointment.weight,
    v_appointment.height,
    v_appointment.temperature,
    'appointment',
    v_appointment.id,
    v_appointment.follow_up_id,
    v_visit_kind
  )
  returning * into v_visit;

  update public.patients
  set current_visit_id = v_visit.id
  where id = v_patient.id
  returning * into v_patient;

  update public.appointments
  set
    status = 'checked_in',
    checked_in_patient_id = v_patient.id,
    checked_in_at = now()
  where id = v_appointment.id
  returning * into v_appointment;

  return jsonb_build_object(
    'appointment', to_jsonb(v_appointment),
    'patient', to_jsonb(v_patient)
  );
end;
$$;

create or replace function public.self_book_follow_up_atomic(
  p_org_id uuid,
  p_patient_id uuid,
  p_follow_up_id uuid,
  p_scheduled_for timestamptz,
  p_appointments_per_hour integer,
  p_timezone text default 'Asia/Kolkata'
) returns jsonb
language plpgsql
as $$
declare
  v_follow_up public.follow_ups%rowtype;
  v_patient public.patients%rowtype;
  v_appointment public.appointments%rowtype;
  v_scheduled_for timestamptz;
  v_hour_bucket timestamp;
  v_capacity integer;
  v_timezone text;
  v_reason text;
begin
  v_scheduled_for := date_trunc('minute', p_scheduled_for);
  v_capacity := least(greatest(coalesce(p_appointments_per_hour, 4), 1), 12);
  v_timezone := coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata');
  v_hour_bucket := date_trunc('hour', v_scheduled_for at time zone v_timezone);

  if v_scheduled_for <= now() then
    raise exception 'Follow-up time must be in the future.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(v_hour_bucket::text));

  select *
  into v_follow_up
  from public.follow_ups
  where id = p_follow_up_id
    and org_id = p_org_id
    and patient_id = p_patient_id
  for update;

  if not found then
    raise exception 'Follow-up not found.';
  end if;

  select *
  into v_appointment
  from public.appointments
  where org_id = p_org_id
    and follow_up_id = p_follow_up_id
  order by created_at desc
  limit 1
  for update;

  if v_follow_up.status <> 'scheduled' and v_appointment.id is null then
    raise exception 'This follow-up is no longer available for booking.';
  end if;

  if v_appointment.status = 'checked_in' then
    raise exception 'This appointment has already been checked in.';
  end if;

  select *
  into v_patient
  from public.patients
  where id = p_patient_id
    and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Patient not found for this organization.';
  end if;

  if exists (
    select 1
    from public.appointments
    where org_id = p_org_id
      and status = 'scheduled'
      and scheduled_for = v_scheduled_for
      and id is distinct from v_appointment.id
  ) then
    raise exception 'That follow-up slot is already booked. Choose another time.';
  end if;

  if (
    select count(*)::integer
    from public.appointments
    where org_id = p_org_id
      and status = 'scheduled'
      and date_trunc('hour', scheduled_for at time zone v_timezone) = v_hour_bucket
      and id is distinct from v_appointment.id
  ) >= v_capacity then
    raise exception 'That hour is fully booked. Choose another follow-up slot.';
  end if;

  update public.follow_ups
  set
    scheduled_for = v_scheduled_for,
    status = 'completed',
    completed_at = coalesce(completed_at, now())
  where id = v_follow_up.id
  returning * into v_follow_up;

  if v_appointment.id is not null then
    update public.appointments
    set
      scheduled_for = v_scheduled_for,
      status = 'scheduled',
      checked_in_patient_id = null,
      checked_in_at = null
    where id = v_appointment.id
    returning * into v_appointment;
  else
    v_reason := 'Follow-up: ' || coalesce(nullif(trim(v_patient.reason), ''), 'Review');

    insert into public.appointments (
    org_id,
    name,
    phone,
    email,
    address,
    reason,
    date_of_birth,
    sex_at_birth,
    gender_identity,
    age,
    weight,
    height,
    temperature,
    scheduled_for,
    status,
    follow_up_id
  )
  values (
    p_org_id,
    v_patient.name,
    v_patient.phone,
    v_patient.email,
    v_patient.address,
    v_reason,
    v_patient.date_of_birth,
    v_patient.sex_at_birth,
    v_patient.gender_identity,
    v_patient.age,
    v_patient.weight,
    v_patient.height,
    v_patient.temperature,
    v_scheduled_for,
    'scheduled',
    v_follow_up.id
  )
    returning * into v_appointment;
  end if;

  return jsonb_build_object(
    'follow_up', to_jsonb(v_follow_up),
    'appointment', to_jsonb(v_appointment)
  );
end;
$$;

create or replace function public.create_invoice_atomic(
  p_org_id uuid,
  p_patient_id uuid,
  p_payment_status text,
  p_amount_paid double precision,
  p_items jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_invoice public.invoices%rowtype;
  v_total double precision;
  v_amount_paid double precision;
begin
  if p_payment_status not in ('unpaid', 'paid', 'partial') then
    raise exception 'Invalid payment status.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Invoice requires at least one item.';
  end if;

  perform 1
  from public.patients
  where id = p_patient_id and org_id = p_org_id;

  if not found then
    raise exception 'Patient not found for this organization.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      catalog_item_id uuid,
      item_type text,
      label text,
      quantity double precision,
      unit_price double precision
    )
    where item.catalog_item_id is not null
      and not exists (
        select 1
        from public.catalog_items ci
        where ci.id = item.catalog_item_id
          and ci.org_id = p_org_id
      )
  ) then
    raise exception 'Inventory item not found for this organization.';
  end if;

  select round(sum((item.quantity * item.unit_price)::numeric), 2)::double precision
  into v_total
  from jsonb_to_recordset(p_items) as item(
    catalog_item_id uuid,
    item_type text,
    label text,
    quantity double precision,
    unit_price double precision
  );

  v_amount_paid := round(coalesce(p_amount_paid, 0)::numeric, 2)::double precision;

  if p_payment_status = 'paid' then
    v_amount_paid := v_total;
  elsif p_payment_status = 'unpaid' then
    v_amount_paid := 0;
  elsif v_amount_paid <= 0 or v_amount_paid >= v_total then
    raise exception 'Partial invoice amount must be greater than zero and less than the total.';
  end if;

  insert into public.invoices (
    org_id,
    patient_id,
    visit_id,
    subtotal,
    total,
    payment_status,
    amount_paid,
    paid_at
  )
  values (
    p_org_id,
    p_patient_id,
    (select current_visit_id from public.patients where id = p_patient_id and org_id = p_org_id),
    v_total,
    v_total,
    p_payment_status,
    v_amount_paid,
    case when p_payment_status = 'paid' then now() else null end
  )
  returning * into v_invoice;

  insert into public.invoice_items (
    org_id,
    invoice_id,
    catalog_item_id,
    item_type,
    label,
    quantity,
    unit_price,
    line_total
  )
  select
    v_invoice.org_id,
    v_invoice.id,
    item.catalog_item_id,
    item.item_type,
    item.label,
    item.quantity,
    item.unit_price,
    round((item.quantity * item.unit_price)::numeric, 2)::double precision
  from jsonb_to_recordset(p_items) as item(
    catalog_item_id uuid,
    item_type text,
    label text,
    quantity double precision,
    unit_price double precision
  );

  return jsonb_build_object(
    'id', v_invoice.id,
    'org_id', v_invoice.org_id,
    'patient_id', v_invoice.patient_id,
    'visit_id', v_invoice.visit_id,
    'subtotal', v_invoice.subtotal,
    'total', v_invoice.total,
    'payment_status', v_invoice.payment_status,
    'amount_paid', v_invoice.amount_paid,
    'balance_due', greatest(round((v_invoice.total - v_invoice.amount_paid)::numeric, 2)::double precision, 0),
    'paid_at', v_invoice.paid_at,
    'completed_at', v_invoice.completed_at,
    'completed_by', v_invoice.completed_by,
    'sent_at', v_invoice.sent_at,
    'created_at', v_invoice.created_at,
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', ii.id,
            'catalog_item_id', ii.catalog_item_id,
            'item_type', ii.item_type,
            'label', ii.label,
            'quantity', ii.quantity,
            'unit_price', ii.unit_price,
            'line_total', ii.line_total
          )
          order by ii.created_at
        )
        from public.invoice_items ii
        where ii.invoice_id = v_invoice.id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.finalize_invoice_atomic(
  p_org_id uuid,
  p_invoice_id uuid,
  p_completed_by uuid
) returns jsonb
language plpgsql
as $$
declare
  v_invoice public.invoices%rowtype;
  v_item record;
begin
  select *
  into v_invoice
  from public.invoices
  where id = p_invoice_id and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Invoice not found for this organization.';
  end if;

  if v_invoice.sent_at is not null then
    return jsonb_build_object(
      'patient_id', v_invoice.patient_id,
      'sent_at', v_invoice.sent_at,
      'completed_at', v_invoice.completed_at,
      'completed_by', v_invoice.completed_by,
      'already_finalized', true
    );
  end if;

  perform 1
  from public.patients
  where id = v_invoice.patient_id and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Patient not found for this organization.';
  end if;

  perform 1
  from public.catalog_items ci
  join public.invoice_items ii on ii.catalog_item_id = ci.id
  where ii.invoice_id = p_invoice_id
    and ci.org_id = p_org_id
    and ci.track_inventory = true
  for update of ci;

  for v_item in
    select
      ci.id,
      ci.name,
      ci.stock_quantity,
      sum(ii.quantity) as required_quantity
    from public.invoice_items ii
    join public.catalog_items ci on ci.id = ii.catalog_item_id
    where ii.invoice_id = p_invoice_id
      and ci.org_id = p_org_id
      and ci.track_inventory = true
    group by ci.id, ci.name, ci.stock_quantity
  loop
    if v_item.stock_quantity < v_item.required_quantity then
      raise exception 'Insufficient stock for %.', v_item.name;
    end if;
  end loop;

  update public.catalog_items ci
  set stock_quantity = ci.stock_quantity - usage.required_quantity
  from (
    select
      ii.catalog_item_id,
      sum(ii.quantity) as required_quantity
    from public.invoice_items ii
    join public.catalog_items ci on ci.id = ii.catalog_item_id
    where ii.invoice_id = p_invoice_id
      and ci.org_id = p_org_id
      and ci.track_inventory = true
    group by ii.catalog_item_id
  ) as usage
  where ci.id = usage.catalog_item_id;

  update public.patients
  set billed = true
  where id = v_invoice.patient_id and org_id = p_org_id;

  update public.invoices
  set
    sent_at = now(),
    completed_at = coalesce(completed_at, now()),
    completed_by = coalesce(completed_by, p_completed_by)
  where id = p_invoice_id
  returning * into v_invoice;

  return jsonb_build_object(
    'patient_id', v_invoice.patient_id,
    'sent_at', v_invoice.sent_at,
    'completed_at', v_invoice.completed_at,
    'completed_by', v_invoice.completed_by,
    'already_finalized', false
  );
end;
$$;

create or replace function public.list_invoices_with_details(
  p_org_id uuid
) returns jsonb
language sql
stable
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', invoice_rows.id,
        'org_id', invoice_rows.org_id,
        'patient_id', invoice_rows.patient_id,
        'patient_name', invoice_rows.patient_name,
        'subtotal', invoice_rows.subtotal,
        'total', invoice_rows.total,
        'payment_status', invoice_rows.payment_status,
        'amount_paid', invoice_rows.amount_paid,
        'balance_due', invoice_rows.balance_due,
        'paid_at', invoice_rows.paid_at,
        'completed_at', invoice_rows.completed_at,
        'completed_by', invoice_rows.completed_by,
        'completed_by_name', invoice_rows.completed_by_name,
        'sent_at', invoice_rows.sent_at,
        'created_at', invoice_rows.created_at,
        'items', invoice_rows.items
      )
      order by invoice_rows.created_at desc
    ),
    '[]'::jsonb
  )
  from (
    select
      i.*,
      coalesce(nullif(trim(p.name), ''), 'Unknown patient') as patient_name,
      case
        when cu.id is null then null
        else coalesce(
          nullif(trim(cu.name), ''),
          nullif(initcap(replace(replace(split_part(cu.identifier, '@', 1), '.', ' '), '_', ' ')), ''),
          cu.identifier,
          'User'
        )
      end as completed_by_name,
      greatest(round((i.total - i.amount_paid)::numeric, 2)::double precision, 0) as balance_due,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', ii.id,
              'invoice_id', ii.invoice_id,
              'catalog_item_id', ii.catalog_item_id,
              'item_type', ii.item_type,
              'label', ii.label,
              'quantity', ii.quantity,
              'unit_price', ii.unit_price,
              'line_total', ii.line_total,
              'created_at', ii.created_at
            )
            order by ii.created_at asc
          )
          from public.invoice_items ii
          where ii.invoice_id = i.id
        ),
        '[]'::jsonb
      ) as items
    from public.invoices i
    join public.patients p
      on p.id = i.patient_id
     and p.org_id = p_org_id
    left join public.clinic_users cu
      on cu.id = i.completed_by
     and cu.org_id = p_org_id
    where i.org_id = p_org_id
  ) invoice_rows;
$$;

create or replace function public.get_patient_timeline_source(
  p_org_id uuid,
  p_patient_id uuid
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'patient', to_jsonb(p),
    'clinic_settings', coalesce(
      (
        select to_jsonb(cs)
        from public.clinic_settings cs
        where cs.org_id = p_org_id
        limit 1
      ),
      '{}'::jsonb
    ),
    'visits', coalesce(
      (
        select jsonb_agg(to_jsonb(pv) order by pv.created_at desc)
        from public.patient_visits pv
        where pv.org_id = p_org_id
          and pv.patient_id = p_patient_id
      ),
      '[]'::jsonb
    ),
    'notes', coalesce(
      (
        select jsonb_agg(
          to_jsonb(n) || jsonb_build_object(
            'sent_by_name',
            case
              when cu.id is null then null
              else coalesce(
                nullif(trim(cu.name), ''),
                nullif(initcap(replace(replace(split_part(cu.identifier, '@', 1), '.', ' '), '_', ' ')), ''),
                cu.identifier,
                'User'
              )
            end
          )
          order by n.created_at desc
        )
        from public.notes n
        left join public.clinic_users cu
          on cu.id = n.sent_by
        where n.org_id = p_org_id
          and n.patient_id = p_patient_id
      ),
      '[]'::jsonb
    ),
    'myopia_measurements', coalesce(
      (
        select jsonb_agg(to_jsonb(mm) order by mm.measured_at asc)
        from public.myopia_measurements mm
        where mm.org_id = p_org_id
          and mm.patient_id = p_patient_id
      ),
      '[]'::jsonb
    ),
    'longitudinal_tracks', coalesce(
      (
        select jsonb_agg(to_jsonb(lt) order by lt.measured_at asc)
        from public.longitudinal_tracks lt
        where lt.org_id = p_org_id
          and lt.patient_id = p_patient_id
      ),
      '[]'::jsonb
    ),
    'invoices', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', invoice_rows.id,
            'org_id', invoice_rows.org_id,
            'patient_id', invoice_rows.patient_id,
            'patient_name', invoice_rows.patient_name,
            'subtotal', invoice_rows.subtotal,
            'total', invoice_rows.total,
            'payment_status', invoice_rows.payment_status,
            'amount_paid', invoice_rows.amount_paid,
            'balance_due', invoice_rows.balance_due,
            'paid_at', invoice_rows.paid_at,
            'completed_at', invoice_rows.completed_at,
            'completed_by', invoice_rows.completed_by,
            'completed_by_name', invoice_rows.completed_by_name,
            'sent_at', invoice_rows.sent_at,
            'created_at', invoice_rows.created_at,
            'items', invoice_rows.items
          )
          order by invoice_rows.created_at desc
        )
        from (
          select
            i.*,
            coalesce(nullif(trim(p.name), ''), 'Unknown patient') as patient_name,
            case
              when cu.id is null then null
              else coalesce(
                nullif(trim(cu.name), ''),
                nullif(initcap(replace(replace(split_part(cu.identifier, '@', 1), '.', ' '), '_', ' ')), ''),
                cu.identifier,
                'User'
              )
            end as completed_by_name,
            greatest(round((i.total - i.amount_paid)::numeric, 2)::double precision, 0) as balance_due,
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', ii.id,
                    'invoice_id', ii.invoice_id,
                    'catalog_item_id', ii.catalog_item_id,
                    'item_type', ii.item_type,
                    'label', ii.label,
                    'quantity', ii.quantity,
                    'unit_price', ii.unit_price,
                    'line_total', ii.line_total,
                    'created_at', ii.created_at
                  )
                  order by ii.created_at asc
                )
                from public.invoice_items ii
                where ii.invoice_id = i.id
              ),
              '[]'::jsonb
            ) as items
          from public.invoices i
          join public.patients p
            on p.id = i.patient_id
           and p.org_id = p_org_id
          left join public.clinic_users cu
            on cu.id = i.completed_by
           and cu.org_id = p_org_id
          where i.org_id = p_org_id
            and i.patient_id = p_patient_id
        ) invoice_rows
      ),
      '[]'::jsonb
    ),
    'follow_ups', coalesce(
      (
        select jsonb_agg(to_jsonb(fu) order by fu.scheduled_for desc)
        from public.follow_ups fu
        where fu.org_id = p_org_id
          and fu.patient_id = p_patient_id
      ),
      '[]'::jsonb
    ),
    'appointments', coalesce(
      (
        select jsonb_agg(to_jsonb(a) order by a.created_at desc)
        from public.appointments a
        where a.org_id = p_org_id
          and a.checked_in_patient_id = p_patient_id
      ),
      '[]'::jsonb
    )
  )
  from public.patients p
  where p.org_id = p_org_id
    and p.id = p_patient_id;
$$;

create or replace function public.list_superuser_org_summaries()
returns jsonb
language sql
stable
as $$
  with user_stats as (
    select org_id, count(*)::int as user_count, max(created_at) as last_activity_at
    from public.clinic_users
    group by org_id
  ),
  patient_stats as (
    select org_id, count(*)::int as patient_count, max(coalesce(last_visit_at, created_at)) as last_activity_at
    from public.patients
    group by org_id
  ),
  note_stats as (
    select org_id, count(*)::int as note_count, max(created_at) as last_activity_at
    from public.notes
    group by org_id
  ),
  invoice_stats as (
    select org_id, count(*)::int as invoice_count, max(created_at) as last_activity_at
    from public.invoices
    group by org_id
  ),
  follow_up_stats as (
    select org_id, count(*)::int as follow_up_count, max(coalesce(scheduled_for, created_at)) as last_activity_at
    from public.follow_ups
    group by org_id
  ),
  audit_stats as (
    select org_id, max(created_at) as last_activity_at
    from public.audit_events
    group by org_id
  ),
  usage_stats as (
    select org_id, coalesce(sum(total_tokens), 0) as total_tokens
    from public.ai_usage_events
    group by org_id
  ),
  rows as (
    select
      o.id as org_id,
      coalesce(nullif(trim(cs.clinic_name), ''), nullif(trim(o.name), ''), 'Clinic') as clinic_name,
      o.created_at,
      coalesce(us.user_count, 0) as user_count,
      coalesce(ps.patient_count, 0) as patient_count,
      coalesce(ns.note_count, 0) as note_count,
      coalesce(inv.invoice_count, 0) as invoice_count,
      coalesce(fus.follow_up_count, 0) as follow_up_count,
      coalesce(ugs.total_tokens, 0) as total_tokens,
      greatest(
        o.created_at,
        coalesce(cs.updated_at, o.created_at),
        coalesce(us.last_activity_at, o.created_at),
        coalesce(ps.last_activity_at, o.created_at),
        coalesce(ns.last_activity_at, o.created_at),
        coalesce(inv.last_activity_at, o.created_at),
        coalesce(fus.last_activity_at, o.created_at),
        coalesce(aus.last_activity_at, o.created_at)
      ) as last_activity_at
    from public.organizations o
    left join public.clinic_settings cs on cs.org_id = o.id
    left join user_stats us on us.org_id = o.id
    left join patient_stats ps on ps.org_id = o.id
    left join note_stats ns on ns.org_id = o.id
    left join invoice_stats inv on inv.org_id = o.id
    left join follow_up_stats fus on fus.org_id = o.id
    left join audit_stats aus on aus.org_id = o.id
    left join usage_stats ugs on ugs.org_id = o.id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'org_id', rows.org_id,
        'clinic_name', rows.clinic_name,
        'created_at', rows.created_at,
        'user_count', rows.user_count,
        'patient_count', rows.patient_count,
        'note_count', rows.note_count,
        'invoice_count', rows.invoice_count,
        'follow_up_count', rows.follow_up_count,
        'total_tokens', rows.total_tokens,
        'last_activity_at', rows.last_activity_at
      )
      order by rows.last_activity_at desc
    ),
    '[]'::jsonb
  )
  from rows;
$$;
