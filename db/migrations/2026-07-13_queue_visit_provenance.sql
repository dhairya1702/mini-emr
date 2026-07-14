begin;

alter table public.appointments
  add column if not exists follow_up_id uuid;

alter table public.patient_visits
  add column if not exists follow_up_id uuid;

with matched as (
  select distinct on (appointment.id)
    appointment.id as appointment_id,
    follow_up.id as follow_up_id
  from public.appointments appointment
  join public.patient_visits visit
    on visit.org_id = appointment.org_id
   and visit.appointment_id = appointment.id
  join public.follow_ups follow_up
    on follow_up.org_id = visit.org_id
   and follow_up.patient_id = visit.patient_id
   and follow_up.scheduled_for = appointment.scheduled_for
  order by appointment.id, follow_up.completed_at desc nulls last, follow_up.created_at desc
)
update public.appointments appointment
set follow_up_id = matched.follow_up_id
from matched
where appointment.id = matched.appointment_id
  and appointment.follow_up_id is null;

with matched as (
  select distinct on (appointment.id)
    appointment.id as appointment_id,
    follow_up.id as follow_up_id
  from public.appointments appointment
  join public.patients patient
    on patient.org_id = appointment.org_id
   and patient.phone = appointment.phone
  join public.follow_ups follow_up
    on follow_up.org_id = appointment.org_id
   and follow_up.patient_id = patient.id
   and follow_up.scheduled_for = appointment.scheduled_for
  where appointment.follow_up_id is null
    and appointment.reason ilike 'Follow-up:%'
  order by appointment.id, follow_up.completed_at desc nulls last, follow_up.created_at desc
)
update public.appointments appointment
set follow_up_id = matched.follow_up_id
from matched
where appointment.id = matched.appointment_id;

update public.patient_visits visit
set follow_up_id = appointment.follow_up_id
from public.appointments appointment
where appointment.id = visit.appointment_id
  and appointment.org_id = visit.org_id
  and appointment.follow_up_id is not null
  and visit.follow_up_id is null;

update public.patient_visits
set visit_kind = case when follow_up_id is not null then 'follow_up' else 'new' end
where visit_kind is distinct from case when follow_up_id is not null then 'follow_up' else 'new' end;

alter table public.appointments
  drop constraint if exists appointments_follow_up_id_fkey;
alter table public.appointments
  add constraint appointments_follow_up_id_fkey
  foreign key (follow_up_id) references public.follow_ups(id) on delete set null;

alter table public.patient_visits
  drop constraint if exists patient_visits_follow_up_id_fkey;
alter table public.patient_visits
  add constraint patient_visits_follow_up_id_fkey
  foreign key (follow_up_id) references public.follow_ups(id) on delete set null;

create index if not exists appointments_org_follow_up_idx
  on public.appointments (org_id, follow_up_id);
create index if not exists patient_visits_org_follow_up_idx
  on public.patient_visits (org_id, follow_up_id);

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

  v_visit_kind := case when v_appointment.follow_up_id is not null then 'follow_up' else 'new' end;

  if p_existing_patient_id is not null then
    select * into v_patient from public.patients
    where id = p_existing_patient_id and org_id = p_org_id for update;
    if not found then raise exception 'Selected patient not found for this organization.'; end if;
    if v_patient.billed then raise exception 'Only active queue patients can be linked to this appointment.'; end if;
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
    appointment_id, follow_up_id, visit_kind
  ) values (
    p_org_id, v_patient.id, v_appointment.name, v_appointment.phone,
    v_appointment.email, v_appointment.address, v_appointment.reason,
    v_appointment.date_of_birth, v_appointment.sex_at_birth,
    v_appointment.gender_identity, v_appointment.age, v_appointment.weight,
    v_appointment.height, v_appointment.temperature, 'appointment',
    v_appointment.id, v_appointment.follow_up_id, v_visit_kind
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
) returns jsonb language plpgsql as $$
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
    gender_identity, age, weight, height, temperature, scheduled_for, status, follow_up_id
  ) values (
    p_org_id, v_patient.name, v_patient.phone, v_patient.email, v_patient.address,
    v_reason, v_patient.date_of_birth, v_patient.sex_at_birth, v_patient.gender_identity,
    v_patient.age, v_patient.weight, v_patient.height, v_patient.temperature,
    v_scheduled_for, 'scheduled', v_follow_up.id
  ) returning * into v_appointment;
  return jsonb_build_object('follow_up', to_jsonb(v_follow_up), 'appointment', to_jsonb(v_appointment));
end;
$$;

commit;
