begin;

alter table public.patients add column if not exists sex_at_birth text;
alter table public.patients add column if not exists gender_identity text not null default '';
alter table public.patients add column if not exists current_visit_id uuid;
alter table public.appointments add column if not exists sex_at_birth text;
alter table public.appointments add column if not exists gender_identity text not null default '';
alter table public.patient_visits add column if not exists sex_at_birth text;
alter table public.patient_visits add column if not exists gender_identity text not null default '';
alter table public.patient_visits add column if not exists visit_kind text not null default 'new';
alter table public.invoices add column if not exists visit_id uuid;

alter table public.patients drop constraint if exists patients_sex_at_birth_check;
alter table public.patients add constraint patients_sex_at_birth_check
  check (sex_at_birth in ('female', 'male', 'intersex', 'prefer_not_to_say', 'unknown'));
alter table public.appointments drop constraint if exists appointments_sex_at_birth_check;
alter table public.appointments add constraint appointments_sex_at_birth_check
  check (sex_at_birth in ('female', 'male', 'intersex', 'prefer_not_to_say', 'unknown'));
alter table public.patient_visits drop constraint if exists patient_visits_sex_at_birth_check;
alter table public.patient_visits add constraint patient_visits_sex_at_birth_check
  check (sex_at_birth in ('female', 'male', 'intersex', 'prefer_not_to_say', 'unknown'));
alter table public.patient_visits drop constraint if exists patient_visits_visit_kind_check;
alter table public.patient_visits add constraint patient_visits_visit_kind_check
  check (visit_kind in ('new', 'follow_up'));

with ranked as (
  select id,
    case when row_number() over (partition by patient_id order by created_at, id) = 1
      then 'new' else 'follow_up' end as next_kind
  from public.patient_visits
)
update public.patient_visits visit set visit_kind = ranked.next_kind
from ranked where ranked.id = visit.id;

update public.patients patient
set current_visit_id = (
  select visit.id from public.patient_visits visit
  where visit.patient_id = patient.id and visit.org_id = patient.org_id
  order by visit.created_at desc, visit.id desc limit 1
)
where patient.current_visit_id is null
  and exists (select 1 from public.patient_visits visit where visit.patient_id = patient.id and visit.org_id = patient.org_id);

update public.invoices invoice
set visit_id = (
  select visit.id from public.patient_visits visit
  where visit.patient_id = invoice.patient_id and visit.org_id = invoice.org_id
    and visit.created_at <= invoice.created_at
  order by visit.created_at desc, visit.id desc limit 1
)
where invoice.visit_id is null
  and exists (
    select 1 from public.patient_visits visit
    where visit.patient_id = invoice.patient_id and visit.org_id = invoice.org_id
      and visit.created_at <= invoice.created_at
  );

alter table public.patients drop constraint if exists patients_current_visit_id_fkey;
alter table public.patients add constraint patients_current_visit_id_fkey
  foreign key (current_visit_id) references public.patient_visits(id) on delete set null;
alter table public.invoices drop constraint if exists invoices_visit_id_fkey;
alter table public.invoices add constraint invoices_visit_id_fkey
  foreign key (visit_id) references public.patient_visits(id) on delete set null;

create index if not exists patients_current_visit_idx on public.patients (org_id, current_visit_id);
create index if not exists invoices_visit_created_idx on public.invoices (org_id, visit_id, created_at desc);

create or replace function public.check_in_appointment_atomic(
  p_org_id uuid, p_appointment_id uuid, p_existing_patient_id uuid default null
) returns jsonb language plpgsql as $$
declare
  v_appointment public.appointments%rowtype;
  v_patient public.patients%rowtype;
  v_visit public.patient_visits%rowtype;
  v_visit_kind text;
begin
  select * into v_appointment from public.appointments
  where id = p_appointment_id and org_id = p_org_id for update;
  if not found then raise exception 'Appointment not found for this organization.'; end if;
  if v_appointment.status <> 'scheduled' then
    raise exception 'Only scheduled appointments can be added to the waiting queue.';
  end if;

  if p_existing_patient_id is not null then
    select * into v_patient from public.patients
    where id = p_existing_patient_id and org_id = p_org_id for update;
    if not found then raise exception 'Selected patient not found for this organization.'; end if;
    if v_patient.billed then raise exception 'Only active queue patients can be linked to this appointment.'; end if;
    v_visit_kind := case when exists (
      select 1 from public.patient_visits where org_id = p_org_id and patient_id = v_patient.id
    ) then 'follow_up' else 'new' end;
    update public.patients set
      name = v_appointment.name, phone = v_appointment.phone, email = v_appointment.email,
      address = v_appointment.address, reason = v_appointment.reason,
      date_of_birth = v_appointment.date_of_birth, sex_at_birth = v_appointment.sex_at_birth,
      gender_identity = v_appointment.gender_identity, age = v_appointment.age,
      weight = v_appointment.weight, height = v_appointment.height,
      temperature = v_appointment.temperature, status = 'waiting', billed = false,
      last_visit_at = now()
    where id = v_patient.id returning * into v_patient;
  else
    v_visit_kind := 'new';
    insert into public.patients (
      org_id, name, phone, email, address, reason, date_of_birth, sex_at_birth,
      gender_identity, age, weight, height, temperature, status, billed, last_visit_at
    ) values (
      p_org_id, v_appointment.name, v_appointment.phone, v_appointment.email,
      v_appointment.address, v_appointment.reason, v_appointment.date_of_birth,
      v_appointment.sex_at_birth, v_appointment.gender_identity, v_appointment.age,
      v_appointment.weight, v_appointment.height, v_appointment.temperature,
      'waiting', false, now()
    ) returning * into v_patient;
  end if;

  insert into public.patient_visits (
    org_id, patient_id, name, phone, email, address, reason, date_of_birth,
    sex_at_birth, gender_identity, age, weight, height, temperature, source,
    appointment_id, visit_kind
  ) values (
    p_org_id, v_patient.id, v_appointment.name, v_appointment.phone,
    v_appointment.email, v_appointment.address, v_appointment.reason,
    v_appointment.date_of_birth, v_appointment.sex_at_birth,
    v_appointment.gender_identity, v_appointment.age, v_appointment.weight,
    v_appointment.height, v_appointment.temperature, 'appointment',
    v_appointment.id, v_visit_kind
  ) returning * into v_visit;

  update public.patients set current_visit_id = v_visit.id
  where id = v_patient.id returning * into v_patient;
  update public.appointments set status = 'checked_in', checked_in_patient_id = v_patient.id,
    checked_in_at = now() where id = v_appointment.id returning * into v_appointment;
  return jsonb_build_object('appointment', to_jsonb(v_appointment), 'patient', to_jsonb(v_patient));
end;
$$;

create or replace function public.self_book_follow_up_atomic(
  p_org_id uuid,
  p_patient_id uuid,
  p_follow_up_id uuid,
  p_scheduled_for timestamptz,
  p_appointments_per_hour integer,
  p_timezone text default 'UTC'
) returns jsonb
language plpgsql
as $$
declare
  v_follow_up public.follow_ups%rowtype;
  v_patient public.patients%rowtype;
  v_appointment public.appointments%rowtype;
  v_scheduled_for timestamptz;
  v_hour_bucket timestamp;
  v_capacity integer;
  v_timezone text;
  v_reason text;
begin
  v_scheduled_for := date_trunc('minute', p_scheduled_for);
  v_capacity := least(greatest(coalesce(p_appointments_per_hour, 4), 1), 12);
  v_timezone := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_hour_bucket := date_trunc('hour', v_scheduled_for at time zone v_timezone);
  if v_scheduled_for <= now() then raise exception 'Follow-up time must be in the future.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(v_hour_bucket::text));

  select * into v_follow_up from public.follow_ups
  where id = p_follow_up_id and org_id = p_org_id and patient_id = p_patient_id for update;
  if not found then raise exception 'Follow-up not found.'; end if;
  if v_follow_up.status <> 'scheduled' then raise exception 'This follow-up is no longer available for booking.'; end if;
  select * into v_patient from public.patients
  where id = p_patient_id and org_id = p_org_id for update;
  if not found then raise exception 'Patient not found for this organization.'; end if;
  if exists (
    select 1 from public.appointments
    where org_id = p_org_id and status = 'scheduled' and scheduled_for = v_scheduled_for
  ) then raise exception 'That follow-up slot is already booked. Choose another time.'; end if;
  if (
    select count(*)::integer from public.appointments
    where org_id = p_org_id and status = 'scheduled'
      and date_trunc('hour', scheduled_for at time zone v_timezone) = v_hour_bucket
  ) >= v_capacity then raise exception 'That hour is fully booked. Choose another follow-up slot.'; end if;

  update public.follow_ups set scheduled_for = v_scheduled_for, status = 'completed', completed_at = now()
  where id = v_follow_up.id returning * into v_follow_up;
  v_reason := 'Follow-up: ' || coalesce(nullif(trim(v_patient.reason), ''), 'Review');
  insert into public.appointments (
    org_id, name, phone, email, address, reason, date_of_birth, sex_at_birth,
    gender_identity, age, weight, height, temperature, scheduled_for, status
  ) values (
    p_org_id, v_patient.name, v_patient.phone, v_patient.email, v_patient.address,
    v_reason, v_patient.date_of_birth, v_patient.sex_at_birth, v_patient.gender_identity,
    v_patient.age, v_patient.weight, v_patient.height, v_patient.temperature,
    v_scheduled_for, 'scheduled'
  ) returning * into v_appointment;
  return jsonb_build_object('follow_up', to_jsonb(v_follow_up), 'appointment', to_jsonb(v_appointment));
end;
$$;

commit;
