begin;

create index if not exists patients_org_unbilled_done_idx
on public.patients (org_id, last_visit_at desc)
where status = 'done' and billed = false;

commit;
