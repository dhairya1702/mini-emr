begin;

create unique index if not exists patients_org_id_id_uidx
  on public.patients(org_id, id);
create unique index if not exists clinic_users_org_id_id_uidx
  on public.clinic_users(org_id, id);
create unique index if not exists notes_org_id_id_uidx
  on public.notes(org_id, id);
create unique index if not exists appointments_org_id_id_uidx
  on public.appointments(org_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_org_patient_fk') then
    alter table public.notes add constraint notes_org_patient_fk
      foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_org_root_fk') then
    alter table public.notes add constraint notes_org_root_fk
      foreign key (org_id, root_note_id) references public.notes(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notes_org_amended_from_fk') then
    alter table public.notes add constraint notes_org_amended_from_fk
      foreign key (org_id, amended_from_note_id) references public.notes(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_attachments_org_patient_fk') then
    alter table public.patient_attachments add constraint patient_attachments_org_patient_fk
      foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_org_patient_fk') then
    alter table public.invoices add constraint invoices_org_patient_fk
      foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'follow_ups_org_patient_fk') then
    alter table public.follow_ups add constraint follow_ups_org_patient_fk
      foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_org_checked_in_patient_fk') then
    alter table public.appointments add constraint appointments_org_checked_in_patient_fk
      foreign key (org_id, checked_in_patient_id) references public.patients(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_visits_org_patient_fk') then
    alter table public.patient_visits add constraint patient_visits_org_patient_fk
      foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patient_visits_org_appointment_fk') then
    alter table public.patient_visits add constraint patient_visits_org_appointment_fk
      foreign key (org_id, appointment_id) references public.appointments(org_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'myopia_measurements_org_patient_fk') then
    alter table public.myopia_measurements add constraint myopia_measurements_org_patient_fk
      foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'longitudinal_tracks_org_patient_fk') then
    alter table public.longitudinal_tracks add constraint longitudinal_tracks_org_patient_fk
      foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'case_studies_org_patient_fk') then
    alter table public.case_studies add constraint case_studies_org_patient_fk
      foreign key (org_id, patient_id) references public.patients(org_id, id) on delete cascade;
  end if;
end
$$;

commit;
