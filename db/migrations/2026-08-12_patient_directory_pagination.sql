-- Supports stable cursor pagination for the basic patient directory.

create index if not exists patients_org_last_visit_id_idx
  on public.patients (org_id, last_visit_at desc, id desc);
