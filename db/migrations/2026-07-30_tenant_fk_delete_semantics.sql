begin;

alter table public.public_check_in_requests
  drop constraint if exists public_check_in_requests_org_approved_patient_fk,
  add constraint public_check_in_requests_org_approved_patient_fk
    foreign key (org_id, approved_patient_id)
    references public.patients(org_id, id)
    on delete set null (approved_patient_id),
  drop constraint if exists public_check_in_requests_org_reviewed_by_fk,
  add constraint public_check_in_requests_org_reviewed_by_fk
    foreign key (org_id, reviewed_by)
    references public.clinic_users(org_id, id)
    on delete set null (reviewed_by);

alter table public.appointments
  drop constraint if exists appointments_org_follow_up_fk,
  add constraint appointments_org_follow_up_fk
    foreign key (org_id, follow_up_id)
    references public.follow_ups(org_id, id)
    on delete set null (follow_up_id);

alter table public.patient_visits
  drop constraint if exists patient_visits_org_follow_up_fk,
  add constraint patient_visits_org_follow_up_fk
    foreign key (org_id, follow_up_id)
    references public.follow_ups(org_id, id)
    on delete set null (follow_up_id);

alter table public.patient_program_enrollments
  drop constraint if exists patient_program_enrollments_org_responsible_user_fk,
  add constraint patient_program_enrollments_org_responsible_user_fk
    foreign key (org_id, responsible_user_id)
    references public.clinic_users(org_id, id)
    on delete set null (responsible_user_id);

alter table public.care_program_events
  drop constraint if exists care_program_events_org_source_event_fk,
  add constraint care_program_events_org_source_event_fk
    foreign key (org_id, source_event_id)
    references public.care_program_events(org_id, id)
    on delete set null (source_event_id),
  drop constraint if exists care_program_events_org_created_by_fk,
  add constraint care_program_events_org_created_by_fk
    foreign key (org_id, created_by)
    references public.clinic_users(org_id, id)
    on delete set null (created_by);

commit;
