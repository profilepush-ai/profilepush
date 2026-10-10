/*
# A picture for every job

Each matched job gets its own AI image, made from its own details: a persona
doing that job, in that place, with that job's tools as simple props. The
job-visual edge function writes it (Claude writes the art direction, the
image model draws it), stores it in the public job-visuals bucket and records
it here; Today's cards carry its URL as lead.visual.

Spend is capped per day by the JOB_VISUAL_DAILY_CAP function secret (0 = off;
internal accounts can always make previews).
*/

create table if not exists public.job_visuals (
  job_id uuid primary key,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  url text,
  model text,
  prompt text,
  error text,
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_visuals_done_idx on public.job_visuals (updated_at desc) where status = 'done';
alter table public.job_visuals enable row level security;
drop policy if exists job_visuals_read on public.job_visuals;
create policy job_visuals_read on public.job_visuals for select to authenticated using (true);

insert into storage.buckets (id, name, public) values ('job-visuals', 'job-visuals', true) on conflict (id) do nothing;

create or replace function public.pp_job_card_json(j public.social_jobs)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', j.id, 'kind', 'job',
    'title', coalesce(nullif(btrim(j.job_title), ''), 'Job'),
    'company', nullif(btrim(j.company_name), ''),
    'poster', nullif(btrim(j.posted_by_name), ''),
    'avatar', nullif(btrim(j.avatar_url), ''),
    'location', nullif(btrim(j.location), ''),
    'pay', nullif(btrim(j.salary_range), ''),
    'rate_min', j.extracted_hourly_rate_min, 'rate_max', j.extracted_hourly_rate_max,
    'skills', coalesce(j.extracted_skills, '[]'::jsonb),
    'visas', coalesce(j.extracted_visa_types, '[]'::jsonb),
    'exp', j.extracted_experience_years,
    'type', nullif(btrim(j.employment_type), ''),
    'source', j.post_source,
    'post_url', j.post_url,
    'apply_url', case when j.post_source = 'career_site' then j.post_url end,
    'has_email', coalesce(btrim(j.poster_email), '') <> '',
    'posted_at', coalesce(j.posted_at, j.created_at),
    'open', coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null,
    'category', j.job_category,
    'visual', (select v.url from public.job_visuals v where v.job_id = j.id and v.status = 'done'),
    'logo_domain', case when j.post_source = 'career_site' then (
      select substring(cs.careers_url from '^https?://(?:www\.)?([^/:?#]+)')
      from public.career_sites cs
      where cs.slug = split_part(j.post_id, ':', 1) and cs.kind not in ('adzuna', 'jooble')
    ) end
  )
$$;
