begin;

alter table public.notes
  add column if not exists clinical_extractions jsonb not null
    default '{"services_performed":[],"medications_prescribed":[]}'::jsonb,
  add column if not exists snapshot_clinical_extractions jsonb;

alter table public.catalog_items
  add column if not exists aliases jsonb not null default '[]'::jsonb;

-- Preserve structured prescriptions from the legacy five-column medicine
-- tables without making any AI calls during migration.
with note_lines as (
  select note.id as note_id, line.value as line, line.ordinality as line_number
  from public.notes note
  cross join lateral regexp_split_to_table(note.content, E'\n') with ordinality as line(value, ordinality)
), headers as (
  select note_id, min(line_number) as header_line
  from note_lines
  where lower(trim(line)) = 'medicine | quantity | schedule | duration | notes'
  group by note_id
), boundaries as (
  select header.note_id, header.header_line,
         coalesce(min(line.line_number) filter (
           where line.line_number > header.header_line + 1
             and trim(line.line) <> ''
             and position('|' in line.line) = 0
         ), 2147483647) as end_line
  from headers header
  join note_lines line on line.note_id = header.note_id
  group by header.note_id, header.header_line
), medicine_rows as (
  select line.note_id,
         regexp_split_to_array(trim(line.line), '\s*\|\s*') as columns
  from note_lines line
  join boundaries boundary on boundary.note_id = line.note_id
  where line.line_number > boundary.header_line + 1
    and line.line_number < boundary.end_line
    and position('|' in line.line) > 0
    and trim(line.line) !~ '^[-:| ]+$'
), extracted as (
  select note_id, jsonb_agg(jsonb_build_object(
    'name', columns[1],
    'strength', '',
    'dose', '',
    'route', '',
    'schedule', coalesce(columns[3], ''),
    'duration', coalesce(columns[4], ''),
    'quantity', coalesce(columns[2], ''),
    'instructions', coalesce(columns[5], ''),
    'evidence', 'Backfilled from legacy medication table.'
  ) order by columns[1]) as medications
  from medicine_rows
  where coalesce(columns[1], '') <> ''
  group by note_id
)
update public.notes note
set clinical_extractions = jsonb_set(
  note.clinical_extractions,
  '{medications_prescribed}',
  extracted.medications,
  true
)
from extracted
where note.id = extracted.note_id
  and note.clinical_extractions->'medications_prescribed' = '[]'::jsonb;

update public.notes
set snapshot_clinical_extractions = clinical_extractions
where status in ('final', 'sent')
  and snapshot_clinical_extractions is null;

alter table public.notes
  drop constraint if exists notes_clinical_extractions_object_check;

alter table public.notes
  add constraint notes_clinical_extractions_object_check
  check (jsonb_typeof(clinical_extractions) = 'object');

alter table public.catalog_items
  drop constraint if exists catalog_items_aliases_array_check;

alter table public.catalog_items
  add constraint catalog_items_aliases_array_check
  check (jsonb_typeof(aliases) = 'array');

commit;
