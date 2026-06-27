begin;

create table if not exists public.api_request_metrics (
  metric_date date not null,
  org_id uuid not null,
  request_count bigint not null default 0 check (request_count >= 0),
  error_response_count bigint not null default 0 check (error_response_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (metric_date, org_id)
);

create index if not exists api_request_metrics_metric_date_idx
  on public.api_request_metrics(metric_date desc);

commit;
