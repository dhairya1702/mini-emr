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
  email text not null default '',
  address text not null default '',
  reason text not null,
  age integer,
  weight double precision,
  height double precision,
  temperature double precision,
  status text not null default 'waiting' check (status in ('waiting', 'consultation', 'done')),
  billed boolean not null default false,
  created_at timestamptz not null default now(),
  last_visit_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  content text not null,
  status text not null default 'draft' check (status in ('draft', 'final', 'sent')),
  version_number integer not null default 1,
  root_note_id uuid references public.notes(id) on delete set null,
  amended_from_note_id uuid references public.notes(id) on delete set null,
  snapshot_content text,
  asset_payload jsonb not null default '[]'::jsonb,
  snapshot_asset_payload jsonb not null default '[]'::jsonb,
  finalized_at timestamptz,
  sent_at timestamptz,
  sent_by uuid references public.clinic_users(id) on delete set null,
  sent_to text,
  created_at timestamptz not null default now()
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
  sender_name text not null default '',
  sender_email text not null default '',
  sender_email_app_password text,
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
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  item_type text not null check (item_type in ('service', 'medicine')),
  default_price double precision not null default 0,
  track_inventory boolean not null default false,
  stock_quantity double precision not null default 0,
  low_stock_threshold double precision not null default 0,
  unit text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  subtotal double precision not null default 0,
  total double precision not null default 0,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'partial')),
  amount_paid double precision not null default 0,
  paid_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references public.clinic_users(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  catalog_item_id uuid references public.catalog_items(id) on delete set null,
  item_type text not null check (item_type in ('service', 'medicine')),
  label text not null,
  quantity double precision not null,
  unit_price double precision not null,
  line_total double precision not null,
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

create index if not exists ai_usage_events_org_id_created_at_idx
  on public.ai_usage_events(org_id, created_at desc);

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
  age integer,
  weight double precision,
  height double precision,
  temperature double precision,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'checked_in', 'cancelled')),
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
  age integer,
  weight double precision,
  height double precision,
  temperature double precision,
  source text not null default 'queue' check (source in ('queue', 'appointment')),
  appointment_id uuid references public.appointments(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.patients
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.patients
add column if not exists billed boolean not null default false;

alter table public.patients
add column if not exists last_visit_at timestamptz not null default now();

alter table public.patients
add column if not exists email text not null default '';

alter table public.patients
add column if not exists address text not null default '';

update public.patients
set last_visit_at = created_at
where last_visit_at is null;

alter table public.notes
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

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

alter table public.catalog_items
add column if not exists track_inventory boolean not null default false;

alter table public.ai_usage_events
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.ai_usage_events
add column if not exists provider text not null default 'anthropic';

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
create index if not exists patient_visits_patient_created_idx on public.patient_visits (patient_id, created_at desc);
create index if not exists notes_org_patient_id_idx on public.notes (org_id, patient_id, created_at desc);
create index if not exists clinic_users_org_role_idx on public.clinic_users (org_id, role, created_at desc);
create index if not exists catalog_items_org_type_idx on public.catalog_items (org_id, item_type, name);
create index if not exists invoices_org_patient_idx on public.invoices (org_id, patient_id, created_at desc);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id, created_at asc);
create index if not exists audit_events_org_created_idx on public.audit_events (org_id, created_at desc);
create index if not exists follow_ups_org_status_scheduled_idx on public.follow_ups (org_id, status, scheduled_for asc);
create index if not exists follow_ups_patient_idx on public.follow_ups (patient_id, created_at desc);
create index if not exists appointments_org_status_scheduled_idx on public.appointments (org_id, status, scheduled_for asc);

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
    age,
    weight,
    height,
    temperature,
    source,
    appointment_id
  )
  values (
    p_org_id,
    v_patient.id,
    v_appointment.name,
    v_appointment.phone,
    v_appointment.email,
    v_appointment.address,
    v_appointment.reason,
    v_appointment.age,
    v_appointment.weight,
    v_appointment.height,
    v_appointment.temperature,
    'appointment',
    v_appointment.id
  )
  returning * into v_visit;

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
    subtotal,
    total,
    payment_status,
    amount_paid,
    paid_at
  )
  values (
    p_org_id,
    p_patient_id,
    v_total,
    v_total,
    p_payment_status,
    v_amount_paid,
    case when p_payment_status = 'paid' then now() else null end
  )
  returning * into v_invoice;

  insert into public.invoice_items (
    invoice_id,
    catalog_item_id,
    item_type,
    label,
    quantity,
    unit_price,
    line_total
  )
  select
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
