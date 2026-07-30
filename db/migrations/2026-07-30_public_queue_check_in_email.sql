begin;

alter table public.public_check_in_requests
  add column if not exists submitted_email text not null default '';

create index if not exists public_check_in_requests_org_email_idx
  on public.public_check_in_requests (org_id, lower(submitted_email))
  where submitted_email <> '';

commit;
