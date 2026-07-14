begin;

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
      select coalesce(max(queue_position), 0) + 1
      into new.queue_position
      from public.patients
      where org_id = new.org_id and status = new.status;
    end if;
  elsif new.status is distinct from old.status then
    new.stage_entered_at := now();
    if new.queue_position = old.queue_position then
      select coalesce(max(queue_position), 0) + 1
      into new.queue_position
      from public.patients
      where org_id = new.org_id and status = new.status and id <> new.id;
    end if;
  elsif new.status = 'waiting' and new.last_visit_at is distinct from old.last_visit_at then
    new.queue_priority := 'normal';
    new.stage_entered_at := now();
    if new.queue_position = old.queue_position then
      select coalesce(max(queue_position), 0) + 1
      into new.queue_position
      from public.patients
      where org_id = new.org_id and status = 'waiting' and id <> new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists patients_queue_metadata_trigger on public.patients;
create trigger patients_queue_metadata_trigger
before insert or update of status, last_visit_at on public.patients
for each row execute function public.set_patient_queue_metadata();

commit;
