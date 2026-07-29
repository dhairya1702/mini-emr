begin;

alter table public.whatsapp_message_events
  add column if not exists document_type text not null default '',
  add column if not exists document_id text not null default '',
  add column if not exists idempotency_key text not null default '',
  add column if not exists updated_at timestamptz not null default now();

alter table public.whatsapp_message_events
  drop constraint if exists whatsapp_message_events_status_check;

alter table public.whatsapp_message_events
  add constraint whatsapp_message_events_status_check
  check (status in ('received', 'ignored', 'queued', 'sent', 'accepted', 'delivered', 'read', 'failed'));

create unique index if not exists whatsapp_message_events_org_idempotency_uidx
  on public.whatsapp_message_events (org_id, idempotency_key)
  where org_id is not null and idempotency_key <> '';

create index if not exists whatsapp_message_events_org_document_idx
  on public.whatsapp_message_events (org_id, document_type, document_id, created_at desc)
  where document_type <> '' and document_id <> '';

commit;
