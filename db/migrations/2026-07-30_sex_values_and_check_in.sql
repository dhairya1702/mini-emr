begin;

alter table public.patients
  drop constraint if exists patients_sex_at_birth_check;
alter table public.patients
  add constraint patients_sex_at_birth_check
  check (sex_at_birth in ('female', 'male', 'other')) not valid;

alter table public.appointments
  drop constraint if exists appointments_sex_at_birth_check;
alter table public.appointments
  add constraint appointments_sex_at_birth_check
  check (sex_at_birth in ('female', 'male', 'other')) not valid;

alter table public.patient_visits
  drop constraint if exists patient_visits_sex_at_birth_check;
alter table public.patient_visits
  add constraint patient_visits_sex_at_birth_check
  check (sex_at_birth in ('female', 'male', 'other')) not valid;

alter table public.public_check_in_requests
  add column if not exists submitted_sex_at_birth text;

alter table public.public_check_in_requests
  drop constraint if exists public_check_in_requests_submitted_sex_at_birth_check;
alter table public.public_check_in_requests
  add constraint public_check_in_requests_submitted_sex_at_birth_check
  check (
    submitted_sex_at_birth is null
    or submitted_sex_at_birth in ('female', 'male', 'other')
  ) not valid;

commit;
