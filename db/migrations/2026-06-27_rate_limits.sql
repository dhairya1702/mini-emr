begin;

create table if not exists public.api_rate_limits (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);

create index if not exists api_rate_limits_updated_at_idx
  on public.api_rate_limits(updated_at);

commit;
