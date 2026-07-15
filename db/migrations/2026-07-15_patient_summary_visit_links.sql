begin;

alter table public.notes
  add column if not exists visit_id uuid;

alter table public.patients
  add column if not exists ai_summary_source_hash text;

create unique index if not exists patient_visits_org_id_id_uidx
  on public.patient_visits(org_id, id);

-- Link notes created from now on to a visit and preserve tenant isolation.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_org_visit_fk') then
    alter table public.notes add constraint notes_org_visit_fk
      foreign key (org_id, visit_id)
      references public.patient_visits(org_id, id)
      on delete set null;
  end if;
end
$$;

create index if not exists notes_org_visit_created_idx
  on public.notes(org_id, visit_id, created_at desc);

-- Best-effort legacy backfill. A note is linked only when exactly one visit for
-- the patient falls on the same clinic-local calendar date. Ambiguous notes
-- deliberately remain unlinked instead of being assigned to the wrong visit.
with candidates as (
  select
    note.id as note_id,
    min(visit.id::text)::uuid as visit_id,
    count(*) as candidate_count
  from public.notes note
  join public.clinic_settings settings on settings.org_id = note.org_id
  join public.patient_visits visit
    on visit.org_id = note.org_id
   and visit.patient_id = note.patient_id
   and (visit.created_at at time zone coalesce(nullif(settings.timezone, ''), 'UTC'))::date =
       (note.created_at at time zone coalesce(nullif(settings.timezone, ''), 'UTC'))::date
  where note.visit_id is null
  group by note.id
)
update public.notes note
set visit_id = candidates.visit_id
from candidates
where note.id = candidates.note_id
  and candidates.candidate_count = 1;

-- Existing cached summaries were generated with the old note-status filter and
-- bullet prompt, so replace them lazily when a chart is next opened.
update public.patients
set ai_summary_stale = true,
    ai_summary_source_hash = null,
    ai_summary_revision = ai_summary_revision + 1;

commit;
