begin;

alter table public.patients
  add column if not exists phone_match_key text generated always as (
    right(regexp_replace(phone, '\D', '', 'g'), 10)
  ) stored,
  add column if not exists email_normalized text generated always as (
    lower(btrim(email))
  ) stored,
  add column if not exists name_normalized text generated always as (
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
  ) stored;

alter table public.public_check_in_requests
  add column if not exists submitted_phone_match_key text generated always as (
    right(regexp_replace(submitted_phone_normalized, '\D', '', 'g'), 10)
  ) stored,
  add column if not exists submitted_email_normalized text generated always as (
    lower(btrim(submitted_email))
  ) stored,
  add column if not exists submitted_name_normalized text generated always as (
    lower(regexp_replace(btrim(submitted_name), '\s+', ' ', 'g'))
  ) stored;

with duplicate_pending as (
  select id,
    row_number() over (
      partition by org_id, submitted_phone_normalized, submitted_date_of_birth
      order by created_at desc, id desc
    ) as duplicate_rank
  from public.public_check_in_requests
  where status = 'pending'
)
update public.public_check_in_requests check_in
set status = 'expired'
from duplicate_pending duplicate
where check_in.id = duplicate.id
  and duplicate.duplicate_rank > 1;

create unique index if not exists public_check_in_requests_pending_identity_uidx
  on public.public_check_in_requests (
    org_id, submitted_phone_normalized, submitted_date_of_birth
  )
  where status = 'pending';

create index if not exists public_check_in_requests_pending_expiry_idx
  on public.public_check_in_requests (org_id, expires_at)
  where status = 'pending';

create index if not exists patients_org_phone_match_key_idx
  on public.patients (org_id, phone_match_key)
  where phone_match_key <> '';
create index if not exists patients_org_email_normalized_idx
  on public.patients (org_id, email_normalized)
  where email_normalized <> '';
create index if not exists patients_org_name_normalized_idx
  on public.patients (org_id, name_normalized);
create index if not exists patients_org_date_of_birth_idx
  on public.patients (org_id, date_of_birth)
  where date_of_birth is not null;
create index if not exists patient_attachments_org_patient_created_idx
  on public.patient_attachments (org_id, patient_id, created_at desc);

create unique index if not exists invoice_items_org_id_id_uidx
  on public.invoice_items(org_id, id);
create unique index if not exists follow_ups_org_id_id_uidx
  on public.follow_ups(org_id, id);
create unique index if not exists patient_program_enrollments_org_id_id_uidx
  on public.patient_program_enrollments(org_id, id);
create unique index if not exists care_program_events_org_id_id_uidx
  on public.care_program_events(org_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'public_check_in_requests_org_approved_patient_fk') then
    alter table public.public_check_in_requests
      add constraint public_check_in_requests_org_approved_patient_fk
      foreign key (org_id, approved_patient_id) references public.patients(org_id, id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'public_check_in_requests_org_reviewed_by_fk') then
    alter table public.public_check_in_requests
      add constraint public_check_in_requests_org_reviewed_by_fk
      foreign key (org_id, reviewed_by) references public.clinic_users(org_id, id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_org_follow_up_fk') then
    alter table public.appointments
      add constraint appointments_org_follow_up_fk
      foreign key (org_id, follow_up_id) references public.follow_ups(org_id, id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_visits_org_follow_up_fk') then
    alter table public.patient_visits
      add constraint patient_visits_org_follow_up_fk
      foreign key (org_id, follow_up_id) references public.follow_ups(org_id, id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_program_enrollments_org_patient_fk') then
    alter table public.patient_program_enrollments
      add constraint patient_program_enrollments_org_patient_fk
      foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_program_enrollments_org_catalog_item_fk') then
    alter table public.patient_program_enrollments
      add constraint patient_program_enrollments_org_catalog_item_fk
      foreign key (org_id, catalog_item_id) references public.catalog_items(org_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_program_enrollments_org_invoice_fk') then
    alter table public.patient_program_enrollments
      add constraint patient_program_enrollments_org_invoice_fk
      foreign key (org_id, originating_invoice_id) references public.invoices(org_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_program_enrollments_org_invoice_item_fk') then
    alter table public.patient_program_enrollments
      add constraint patient_program_enrollments_org_invoice_item_fk
      foreign key (org_id, originating_invoice_item_id) references public.invoice_items(org_id, id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_program_enrollments_org_responsible_user_fk') then
    alter table public.patient_program_enrollments
      add constraint patient_program_enrollments_org_responsible_user_fk
      foreign key (org_id, responsible_user_id) references public.clinic_users(org_id, id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'care_program_events_org_enrollment_fk') then
    alter table public.care_program_events
      add constraint care_program_events_org_enrollment_fk
      foreign key (org_id, enrollment_id)
      references public.patient_program_enrollments(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'care_program_events_org_source_event_fk') then
    alter table public.care_program_events
      add constraint care_program_events_org_source_event_fk
      foreign key (org_id, source_event_id) references public.care_program_events(org_id, id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'care_program_events_org_created_by_fk') then
    alter table public.care_program_events
      add constraint care_program_events_org_created_by_fk
      foreign key (org_id, created_by) references public.clinic_users(org_id, id) on delete set null;
  end if;
end
$$;

commit;
