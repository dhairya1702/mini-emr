begin;

alter table public.public_check_in_requests
  add column if not exists tracking_token_hash text;

create unique index if not exists public_check_in_requests_tracking_token_hash_uidx
  on public.public_check_in_requests (tracking_token_hash)
  where tracking_token_hash is not null;

commit;
