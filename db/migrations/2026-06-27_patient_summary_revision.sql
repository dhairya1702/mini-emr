begin;

alter table public.patients
add column if not exists ai_summary_revision integer not null default 0;

commit;
