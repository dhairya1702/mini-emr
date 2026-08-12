-- Lightweight revision counters for the Billing workspace.

alter table public.dashboard_revisions
  add column if not exists billing_patients_revision bigint not null default 0,
  add column if not exists billing_invoices_revision bigint not null default 0;

create or replace function public.bump_dashboard_patient_revisions()
returns trigger
language plpgsql
as $$
declare
  affected_org_id uuid;
  old_is_active boolean := false;
  new_is_active boolean := false;
  old_is_billable boolean := false;
  new_is_billable boolean := false;
  candidate_changed boolean := true;
begin
  if tg_op <> 'INSERT' then
    affected_org_id := old.org_id;
    old_is_active := old.status in ('waiting', 'consultation')
      or (old.status = 'done' and old.billed = false);
    old_is_billable := old.status = 'done' and old.billed = false;
  end if;
  if tg_op <> 'DELETE' then
    affected_org_id := new.org_id;
    new_is_active := new.status in ('waiting', 'consultation')
      or (new.status = 'done' and new.billed = false);
    new_is_billable := new.status = 'done' and new.billed = false;
  end if;
  if tg_op = 'UPDATE' then
    candidate_changed := row(
      old.name, old.phone, old.email, old.date_of_birth, old.status, old.last_visit_at
    ) is distinct from row(
      new.name, new.phone, new.email, new.date_of_birth, new.status, new.last_visit_at
    );
  end if;

  insert into public.dashboard_revisions (
    org_id, queue_revision, check_in_revision, billing_patients_revision, updated_at
  )
  select
    affected_org_id,
    case when old_is_active or new_is_active then 1 else 0 end,
    case when candidate_changed then 1 else 0 end,
    case when old_is_billable or new_is_billable then 1 else 0 end,
    now()
  where exists (select 1 from public.organizations where id = affected_org_id)
  on conflict (org_id) do update
    set queue_revision = public.dashboard_revisions.queue_revision
          + case when old_is_active or new_is_active then 1 else 0 end,
        check_in_revision = public.dashboard_revisions.check_in_revision
          + case when candidate_changed then 1 else 0 end,
        billing_patients_revision = public.dashboard_revisions.billing_patients_revision
          + case when old_is_billable or new_is_billable then 1 else 0 end,
        updated_at = now();
  return null;
end;
$$;

create or replace function public.bump_dashboard_invoice_revisions()
returns trigger
language plpgsql
as $$
declare
  affected_org_id uuid;
begin
  if tg_op = 'DELETE' then
    affected_org_id := old.org_id;
  else
    affected_org_id := new.org_id;
  end if;

  insert into public.dashboard_revisions (
    org_id, queue_revision, billing_invoices_revision, updated_at
  )
  select affected_org_id, 1, 1, now()
  where exists (select 1 from public.organizations where id = affected_org_id)
  on conflict (org_id) do update
    set queue_revision = public.dashboard_revisions.queue_revision + 1,
        billing_invoices_revision = public.dashboard_revisions.billing_invoices_revision + 1,
        updated_at = now();
  return null;
end;
$$;

drop trigger if exists dashboard_invoices_queue_revision on public.invoices;
create trigger dashboard_invoices_queue_revision
after insert or update or delete on public.invoices
for each row execute function public.bump_dashboard_invoice_revisions();

drop trigger if exists dashboard_invoice_items_queue_revision on public.invoice_items;
create trigger dashboard_invoice_items_queue_revision
after insert or update or delete on public.invoice_items
for each row execute function public.bump_dashboard_invoice_revisions();
