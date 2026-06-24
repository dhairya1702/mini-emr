-- Migration: patient AI summary cache
-- Adds the columns backing the AI patient-context summary shown in the patient chart.
--
-- Safe to run multiple times (idempotent) and safe on a live database:
-- the columns have defaults so existing rows are backfilled automatically,
-- and ai_summary_stale defaults to true so every patient regenerates lazily
-- the first time their chart is opened.
--
-- Apply with:
--   psql "$DATABASE_URL" -f db/migrations/2026-06-24_patient_ai_summary.sql

begin;

alter table public.patients
  add column if not exists ai_summary text not null default '';

alter table public.patients
  add column if not exists ai_summary_updated_at timestamptz;

alter table public.patients
  add column if not exists ai_summary_stale boolean not null default true;

commit;
