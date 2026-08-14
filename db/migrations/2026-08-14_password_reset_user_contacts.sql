alter table public.clinic_users
add column if not exists email text not null default '',
add column if not exists phone text not null default '';

update public.clinic_users
set email = lower(btrim(identifier))
where email = ''
  and identifier ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$';

create table if not exists public.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.clinic_users(id) on delete cascade,
  token_hash text not null unique,
  requested_by_user_id uuid references public.clinic_users(id) on delete set null,
  requested_by_name text not null default '',
  requester_realm text not null default 'clinic' check (requester_realm in ('clinic', 'superdashboard', 'self')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_created_idx
on public.password_reset_tokens (user_id, created_at desc);

create index if not exists password_reset_tokens_active_idx
on public.password_reset_tokens (token_hash, expires_at)
where used_at is null;
