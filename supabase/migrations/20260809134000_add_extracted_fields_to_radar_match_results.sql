alter table public.radar_match_results
  add column if not exists job_title text,
  add column if not exists role_title text,
  add column if not exists core_skills text[],
  add column if not exists years_experience numeric,
  add column if not exists visa_types text[],
  add column if not exists employment_type text,
  add column if not exists work_type text,
  add column if not exists locations text[],
  add column if not exists hourly_rate_min numeric,
  add column if not exists hourly_rate_max numeric,
  add column if not exists relocation_required boolean,
  add column if not exists extracted_fields jsonb;