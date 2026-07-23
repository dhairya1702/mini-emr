alter table public.clinic_settings
add column if not exists document_template_doctor_name_x double precision not null default 0.1;

alter table public.clinic_settings
add column if not exists document_template_doctor_name_y double precision not null default 0.87;

alter table public.clinic_settings
add column if not exists document_template_doctor_name_width double precision not null default 0.24;

alter table public.clinic_settings
add column if not exists document_template_doctor_name_height double precision not null default 0.04;
