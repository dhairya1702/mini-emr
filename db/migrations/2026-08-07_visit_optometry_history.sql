begin;

alter table public.patient_optometry_histories
  add column if not exists visit_id uuid;

alter table public.patient_optometry_history_revisions
  add column if not exists visit_id uuid;

update public.patient_optometry_histories history
set visit_id = coalesce(
  patient.current_visit_id,
  (
    select visit.id
    from public.patient_visits visit
    where visit.org_id = history.org_id
      and visit.patient_id = history.patient_id
    order by visit.created_at desc, visit.id desc
    limit 1
  )
)
from public.patients patient
where patient.org_id = history.org_id
  and patient.id = history.patient_id
  and history.visit_id is null;

update public.patient_optometry_history_revisions revision
set visit_id = history.visit_id
from public.patient_optometry_histories history
where history.id = revision.history_id
  and revision.visit_id is null;

-- Preserve any legacy history whose patient never had a visit. New application
-- writes always provide visit_id, and visit-scoped reads intentionally ignore
-- these unattributed legacy rows instead of carrying them into a new visit.

alter table public.patient_optometry_histories
  drop constraint if exists patient_optometry_histories_org_id_patient_id_key;

alter table public.patient_optometry_histories
  drop constraint if exists patient_optometry_histories_visit_id_fkey;

alter table public.patient_optometry_histories
  add constraint patient_optometry_histories_visit_id_fkey
  foreign key (visit_id) references public.patient_visits(id) on delete cascade;

alter table public.patient_optometry_history_revisions
  drop constraint if exists patient_optometry_history_revisions_visit_id_fkey;

alter table public.patient_optometry_history_revisions
  add constraint patient_optometry_history_revisions_visit_id_fkey
  foreign key (visit_id) references public.patient_visits(id) on delete cascade;

create unique index if not exists patient_optometry_histories_org_patient_visit_uidx
  on public.patient_optometry_histories (org_id, patient_id, visit_id);

create index if not exists patient_optometry_history_revisions_visit_idx
  on public.patient_optometry_history_revisions (org_id, patient_id, visit_id, revision desc);

commit;
