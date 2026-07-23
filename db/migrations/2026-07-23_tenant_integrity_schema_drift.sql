begin;

alter table public.invoice_items
  add column if not exists org_id uuid;

update public.invoice_items invoice_item
set org_id = invoice.org_id
from public.invoices invoice
where invoice_item.invoice_id = invoice.id
  and invoice_item.org_id is null;

update public.invoice_items invoice_item
set catalog_item_id = null
where invoice_item.catalog_item_id is not null
  and not exists (
    select 1
    from public.catalog_items catalog_item
    where catalog_item.org_id = invoice_item.org_id
      and catalog_item.id = invoice_item.catalog_item_id
  );

alter table public.invoice_items
  alter column org_id set not null;

create unique index if not exists invoices_org_id_id_uidx
  on public.invoices(org_id, id);
create unique index if not exists catalog_items_org_id_id_uidx
  on public.catalog_items(org_id, id);
create unique index if not exists whatsapp_owner_bindings_org_id_id_uidx
  on public.whatsapp_owner_bindings(org_id, id);

create index if not exists invoice_items_org_invoice_idx
  on public.invoice_items(org_id, invoice_id, created_at asc);
create index if not exists invoice_items_org_catalog_item_idx
  on public.invoice_items(org_id, catalog_item_id)
  where catalog_item_id is not null;
create index if not exists notes_org_visit_created_idx
  on public.notes(org_id, visit_id, created_at desc);
create index if not exists follow_ups_due_reminder_claim_idx
  on public.follow_ups (org_id, scheduled_for, reminder_claimed_at)
  where status = 'scheduled' and reminder_sent_at is null;

update public.notes note
set sent_by = null
where note.sent_by is not null
  and not exists (
    select 1 from public.clinic_users clinic_user
    where clinic_user.org_id = note.org_id
      and clinic_user.id = note.sent_by
  );

update public.patient_attachments attachment
set uploaded_by = null
where attachment.uploaded_by is not null
  and not exists (
    select 1 from public.clinic_users clinic_user
    where clinic_user.org_id = attachment.org_id
      and clinic_user.id = attachment.uploaded_by
  );

update public.invoices invoice
set completed_by = null
where invoice.completed_by is not null
  and not exists (
    select 1 from public.clinic_users clinic_user
    where clinic_user.org_id = invoice.org_id
      and clinic_user.id = invoice.completed_by
  );

update public.audit_events audit_event
set actor_user_id = null
where audit_event.actor_user_id is not null
  and not exists (
    select 1 from public.clinic_users clinic_user
    where clinic_user.org_id = audit_event.org_id
      and clinic_user.id = audit_event.actor_user_id
  );

update public.platform_errors platform_error
set user_id = null
where platform_error.user_id is not null
  and not exists (
    select 1 from public.clinic_users clinic_user
    where clinic_user.org_id = platform_error.org_id
      and clinic_user.id = platform_error.user_id
  );

update public.whatsapp_owner_bindings binding
set user_id = null
where binding.user_id is not null
  and not exists (
    select 1 from public.clinic_users clinic_user
    where clinic_user.org_id = binding.org_id
      and clinic_user.id = binding.user_id
  );

update public.whatsapp_message_events message_event
set binding_id = null
where message_event.binding_id is not null
  and not exists (
    select 1 from public.whatsapp_owner_bindings binding
    where binding.org_id = message_event.org_id
      and binding.id = message_event.binding_id
  );

update public.follow_ups follow_up
set created_by = null
where follow_up.created_by is not null
  and not exists (
    select 1 from public.clinic_users clinic_user
    where clinic_user.org_id = follow_up.org_id
      and clinic_user.id = follow_up.created_by
  );

update public.case_studies case_study
set created_by = null
where case_study.created_by is not null
  and not exists (
    select 1 from public.clinic_users clinic_user
    where clinic_user.org_id = case_study.org_id
      and clinic_user.id = case_study.created_by
  );

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_org_fk') then
    alter table public.invoice_items add constraint invoice_items_org_fk
      foreign key (org_id) references public.organizations(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_org_invoice_fk') then
    alter table public.invoice_items add constraint invoice_items_org_invoice_fk
      foreign key (org_id, invoice_id) references public.invoices(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_org_catalog_item_fk') then
    alter table public.invoice_items add constraint invoice_items_org_catalog_item_fk
      foreign key (org_id, catalog_item_id) references public.catalog_items(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_org_sent_by_fk') then
    alter table public.notes add constraint notes_org_sent_by_fk
      foreign key (org_id, sent_by) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_attachments_org_uploaded_by_fk') then
    alter table public.patient_attachments add constraint patient_attachments_org_uploaded_by_fk
      foreign key (org_id, uploaded_by) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_org_completed_by_fk') then
    alter table public.invoices add constraint invoices_org_completed_by_fk
      foreign key (org_id, completed_by) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'audit_events_org_actor_user_fk') then
    alter table public.audit_events add constraint audit_events_org_actor_user_fk
      foreign key (org_id, actor_user_id) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'platform_errors_org_user_fk') then
    alter table public.platform_errors add constraint platform_errors_org_user_fk
      foreign key (org_id, user_id) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_owner_bindings_org_user_fk') then
    alter table public.whatsapp_owner_bindings add constraint whatsapp_owner_bindings_org_user_fk
      foreign key (org_id, user_id) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_message_events_org_binding_fk') then
    alter table public.whatsapp_message_events add constraint whatsapp_message_events_org_binding_fk
      foreign key (org_id, binding_id) references public.whatsapp_owner_bindings(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_org_created_by_fk') then
    alter table public.follow_ups add constraint follow_ups_org_created_by_fk
      foreign key (org_id, created_by) references public.clinic_users(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'case_studies_org_created_by_fk') then
    alter table public.case_studies add constraint case_studies_org_created_by_fk
      foreign key (org_id, created_by) references public.clinic_users(org_id, id);
  end if;
end
$$;

commit;
