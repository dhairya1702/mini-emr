create table if not exists public.customer_onboarding (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null unique,
  customer_name text not null,
  phone text not null,
  users_allowed integer not null default 2 check (users_allowed > 0),
  status text not null default 'pending' check (status in ('pending', 'claimed', 'disabled')),
  claimed_org_id uuid references public.organizations(id) on delete set null,
  claimed_at timestamptz,
  created_by uuid references public.clinic_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_onboarding_phone_idx
  on public.customer_onboarding(phone);

create index if not exists customer_onboarding_status_idx
  on public.customer_onboarding(status);

create index if not exists customer_onboarding_claimed_org_id_idx
  on public.customer_onboarding(claimed_org_id);
