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
  billed boolean not null default false,
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
  paid_at timestamptz,
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

create table if not exists public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_by uuid references public.clinic_users(id) on delete set null,
  scheduled_for timestamptz not null,
  notes text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.patients
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.patients
add column if not exists billed boolean not null default false;

alter table public.notes
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.clinic_users
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.clinic_users
add column if not exists name text not null default '';

alter table public.clinic_settings
add column if not exists org_id uuid references public.organizations(id) on delete cascade;

alter table public.catalog_items
add column if not exists track_inventory boolean not null default false;

alter table public.catalog_items
add column if not exists stock_quantity double precision not null default 0;

alter table public.catalog_items
add column if not exists low_stock_threshold double precision not null default 0;

alter table public.invoices
add column if not exists sent_at timestamptz;

alter table public.invoices
add column if not exists paid_at timestamptz;

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

create unique index if not exists clinic_settings_org_id_key on public.clinic_settings (org_id);
create index if not exists patients_org_status_idx on public.patients (org_id, status, created_at desc);
create index if not exists notes_org_patient_id_idx on public.notes (org_id, patient_id, created_at desc);
create index if not exists clinic_users_org_role_idx on public.clinic_users (org_id, role, created_at desc);
create index if not exists catalog_items_org_type_idx on public.catalog_items (org_id, item_type, name);
create index if not exists invoices_org_patient_idx on public.invoices (org_id, patient_id, created_at desc);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id, created_at asc);
create index if not exists follow_ups_org_status_scheduled_idx on public.follow_ups (org_id, status, scheduled_for asc);
create index if not exists follow_ups_patient_idx on public.follow_ups (patient_id, created_at desc);

create or replace function public.create_invoice_atomic(
  p_org_id uuid,
  p_patient_id uuid,
  p_payment_status text,
  p_items jsonb
) returns jsonb
language plpgsql
as $$
declare
  v_invoice public.invoices%rowtype;
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

  insert into public.invoices (
    org_id,
    patient_id,
    subtotal,
    total,
    payment_status,
    paid_at
  )
  select
    p_org_id,
    p_patient_id,
    round(sum((item.quantity * item.unit_price)::numeric), 2)::double precision,
    round(sum((item.quantity * item.unit_price)::numeric), 2)::double precision,
    p_payment_status,
    case when p_payment_status = 'paid' then now() else null end
  from jsonb_to_recordset(p_items) as item(
    catalog_item_id uuid,
    item_type text,
    label text,
    quantity double precision,
    unit_price double precision
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
    'paid_at', v_invoice.paid_at,
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
  p_invoice_id uuid
) returns uuid
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
    return v_invoice.patient_id;
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
  set sent_at = now()
  where id = p_invoice_id;

  return v_invoice.patient_id;
end;
$$;
