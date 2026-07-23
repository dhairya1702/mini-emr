alter table public.clinic_settings
add column if not exists document_template_note_layout jsonb not null default '{}'::jsonb;
