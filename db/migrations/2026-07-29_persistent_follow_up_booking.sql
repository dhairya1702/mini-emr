begin;

create or replace function public.self_book_follow_up_atomic(
  p_org_id uuid,
  p_patient_id uuid,
  p_follow_up_id uuid,
  p_scheduled_for timestamptz,
  p_appointments_per_hour integer,
  p_timezone text default 'Asia/Kolkata'
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
  v_timezone := coalesce(nullif(trim(p_timezone), ''), 'Asia/Kolkata');
  v_hour_bucket := date_trunc('hour', v_scheduled_for at time zone v_timezone);

  if v_scheduled_for <= now() then
    raise exception 'Follow-up time must be in the future.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_org_id::text), hashtext(v_hour_bucket::text));

  select *
  into v_follow_up
  from public.follow_ups
  where id = p_follow_up_id
    and org_id = p_org_id
    and patient_id = p_patient_id
  for update;

  if not found then
    raise exception 'Follow-up not found.';
  end if;

  select *
  into v_appointment
  from public.appointments
  where org_id = p_org_id
    and follow_up_id = p_follow_up_id
  order by created_at desc
  limit 1
  for update;

  if v_follow_up.status <> 'scheduled' and v_appointment.id is null then
    raise exception 'This follow-up is no longer available for booking.';
  end if;

  if v_appointment.status = 'checked_in' then
    raise exception 'This appointment has already been checked in.';
  end if;

  select *
  into v_patient
  from public.patients
  where id = p_patient_id
    and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Patient not found for this organization.';
  end if;

  if exists (
    select 1
    from public.appointments
    where org_id = p_org_id
      and status = 'scheduled'
      and scheduled_for = v_scheduled_for
      and id is distinct from v_appointment.id
  ) then
    raise exception 'That follow-up slot is already booked. Choose another time.';
  end if;

  if (
    select count(*)::integer
    from public.appointments
    where org_id = p_org_id
      and status = 'scheduled'
      and date_trunc('hour', scheduled_for at time zone v_timezone) = v_hour_bucket
      and id is distinct from v_appointment.id
  ) >= v_capacity then
    raise exception 'That hour is fully booked. Choose another follow-up slot.';
  end if;

  update public.follow_ups
  set
    scheduled_for = v_scheduled_for,
    status = 'completed',
    completed_at = coalesce(completed_at, now())
  where id = v_follow_up.id
  returning * into v_follow_up;

  if v_appointment.id is not null then
    update public.appointments
    set
      scheduled_for = v_scheduled_for,
      status = 'scheduled',
      checked_in_patient_id = null,
      checked_in_at = null
    where id = v_appointment.id
    returning * into v_appointment;
  else
    v_reason := 'Follow-up: ' || coalesce(nullif(trim(v_patient.reason), ''), 'Review');

    insert into public.appointments (
      org_id,
      name,
      phone,
      email,
      address,
      reason,
      date_of_birth,
      sex_at_birth,
      gender_identity,
      age,
      weight,
      height,
      temperature,
      scheduled_for,
      status,
      follow_up_id
    )
    values (
      p_org_id,
      v_patient.name,
      v_patient.phone,
      v_patient.email,
      v_patient.address,
      v_reason,
      v_patient.date_of_birth,
      v_patient.sex_at_birth,
      v_patient.gender_identity,
      v_patient.age,
      v_patient.weight,
      v_patient.height,
      v_patient.temperature,
      v_scheduled_for,
      'scheduled',
      v_follow_up.id
    )
    returning * into v_appointment;
  end if;

  return jsonb_build_object(
    'follow_up', to_jsonb(v_follow_up),
    'appointment', to_jsonb(v_appointment)
  );
end;
$$;

commit;
