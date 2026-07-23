alter table public.clinic_settings
add column if not exists document_template_signature_x double precision not null default 0.1;

alter table public.clinic_settings
add column if not exists document_template_signature_y double precision not null default 0.78;

alter table public.clinic_settings
add column if not exists document_template_signature_width double precision not null default 0.24;

alter table public.clinic_settings
add column if not exists document_template_signature_height double precision not null default 0.08;
