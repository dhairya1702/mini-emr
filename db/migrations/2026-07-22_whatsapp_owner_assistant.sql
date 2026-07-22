begin;

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
  status text not null check (status in ('received', 'ignored', 'sent', 'failed')),
  error text not null default '',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_message_events_org_created_idx
  on public.whatsapp_message_events (org_id, created_at desc);

create index if not exists whatsapp_message_events_wa_message_id_idx
  on public.whatsapp_message_events (wa_message_id);

commit;
