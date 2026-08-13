-- Realtime invalidation events for dashboard revision counters.

create or replace function public.notify_dashboard_revision_change(
  affected_org_id uuid,
  changed_counters text[]
)
returns void
language plpgsql
as $$
declare
  revision_row public.dashboard_revisions%rowtype;
begin
  if affected_org_id is null
    or changed_counters is null
    or coalesce(array_length(changed_counters, 1), 0) = 0 then
    return;
  end if;

  select * into revision_row
  from public.dashboard_revisions
  where org_id = affected_org_id;

  if not found then
    return;
  end if;

  perform pg_notify(
    'clinic_dashboard_revisions',
    json_build_object(
      'org_id', affected_org_id::text,
      'changed', changed_counters,
      'queue_revision', coalesce(revision_row.queue_revision, 0)::text,
      'check_in_revision', coalesce(revision_row.check_in_revision, 0)::text,
      'billing_patients_revision', coalesce(revision_row.billing_patients_revision, 0)::text,
      'billing_invoices_revision', coalesce(revision_row.billing_invoices_revision, 0)::text
    )::text
  );
end;
$$;

create or replace function public.bump_dashboard_queue_revision()
returns trigger language plpgsql as $$
declare affected_org_id uuid;
begin
  if tg_op = 'DELETE' then affected_org_id := old.org_id;
  else affected_org_id := new.org_id;
  end if;
  insert into public.dashboard_revisions (org_id, queue_revision, updated_at)
  select affected_org_id, 1, now()
  where exists (select 1 from public.organizations where id = affected_org_id)
  on conflict (org_id) do update
    set queue_revision = public.dashboard_revisions.queue_revision + 1,
        updated_at = now();
  perform public.notify_dashboard_revision_change(affected_org_id, array['queue']);
  return null;
end;
$$;

create or replace function public.bump_dashboard_check_in_revision()
returns trigger language plpgsql as $$
declare affected_org_id uuid;
begin
  if tg_op = 'DELETE' then affected_org_id := old.org_id;
  else affected_org_id := new.org_id;
  end if;
  insert into public.dashboard_revisions (org_id, check_in_revision, updated_at)
  select affected_org_id, 1, now()
  where exists (select 1 from public.organizations where id = affected_org_id)
  on conflict (org_id) do update
    set check_in_revision = public.dashboard_revisions.check_in_revision + 1,
        updated_at = now();
  perform public.notify_dashboard_revision_change(affected_org_id, array['check_ins']);
  return null;
end;
$$;

create or replace function public.bump_dashboard_patient_revisions()
returns trigger language plpgsql as $$
declare
  affected_org_id uuid;
  old_is_active boolean := false;
  new_is_active boolean := false;
  old_is_billable boolean := false;
  new_is_billable boolean := false;
  candidate_changed boolean := true;
  changed_counters text[] := array[]::text[];
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

  if old_is_active or new_is_active then
    changed_counters := changed_counters || 'queue';
  end if;
  if candidate_changed then
    changed_counters := changed_counters || 'check_ins';
  end if;
  if old_is_billable or new_is_billable then
    changed_counters := changed_counters || 'billing_patients';
  end if;

  insert into public.dashboard_revisions (
    org_id, queue_revision, check_in_revision, billing_patients_revision, updated_at
  )
  select affected_org_id,
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
  perform public.notify_dashboard_revision_change(affected_org_id, changed_counters);
  return null;
end;
$$;

create or replace function public.bump_dashboard_invoice_revisions()
returns trigger language plpgsql as $$
declare affected_org_id uuid;
begin
  if tg_op = 'DELETE' then affected_org_id := old.org_id;
  else affected_org_id := new.org_id;
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
  perform public.notify_dashboard_revision_change(affected_org_id, array['queue', 'billing_invoices']);
  return null;
end;
$$;
