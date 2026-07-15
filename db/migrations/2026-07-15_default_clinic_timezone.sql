alter table public.clinic_settings
alter column timezone set default 'Asia/Kolkata';

update public.clinic_settings
set timezone = 'Asia/Kolkata'
where timezone = 'UTC'
  and onboarding_completed_at is null;
