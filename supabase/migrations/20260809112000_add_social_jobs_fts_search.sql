-- Add FTS support for social_jobs to speed Formula Bar search.

alter table public.social_jobs
  add column if not exists search_document tsvector;

create or replace function public.social_jobs_search_document_tsvector(
  p_job_title text,
  p_company_name text,
  p_location text,
  p_post_content text,
  p_job_description text,
  p_extracted_skills jsonb
)
returns tsvector
language sql
immutable
as $$
  select
    setweight(to_tsvector('english', coalesce(p_job_title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(p_company_name, '')), 'B')
    || setweight(to_tsvector('english', coalesce(p_location, '')), 'B')
    || setweight(to_tsvector('english', coalesce(p_post_content, '')), 'C')
    || setweight(to_tsvector('english', coalesce(p_job_description, '')), 'C')
    || setweight(
      to_tsvector(
        'english',
        coalesce((
          select string_agg(value, ' ')
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(coalesce(p_extracted_skills, '[]'::jsonb)) = 'array' then coalesce(p_extracted_skills, '[]'::jsonb)
              else '[]'::jsonb
            end
          ) as value
        ), '')
      ),
      'A'
    );
$$;

create or replace function public.set_social_jobs_search_document()
returns trigger
language plpgsql
as $$
begin
  new.search_document := public.social_jobs_search_document_tsvector(
    new.job_title,
    new.company_name,
    new.location,
    new.post_content,
    new.job_description,
    new.extracted_skills
  );
  return new;
end;
$$;

drop trigger if exists trg_social_jobs_search_document on public.social_jobs;

create trigger trg_social_jobs_search_document
before insert or update of job_title, company_name, location, post_content, job_description, extracted_skills
on public.social_jobs
for each row
execute function public.set_social_jobs_search_document();

update public.social_jobs
set search_document = public.social_jobs_search_document_tsvector(
  job_title,
  company_name,
  location,
  post_content,
  job_description,
  extracted_skills
)
where search_document is null;

create index if not exists idx_social_jobs_search_document
  on public.social_jobs using gin (search_document);

create or replace function public.search_pulse_social_feed_fts(
  p_query text,
  p_since timestamptz default now() - interval '72 hours',
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  lead_id text,
  profile_id uuid,
  match_created_at timestamptz,
  final_average_score double precision,
  score_breakdown jsonb,
  platform text,
  posted_by_name text,
  poster_email text,
  poster_phone text,
  social_created_at timestamptz,
  posted_at timestamptz,
  job_title text,
  company_name text,
  location text,
  post_content text,
  extracted_role_normalized text,
  employment_type text,
  seniority_level text,
  salary_range text,
  extracted_skills text[],
  extracted_experience_years integer,
  extracted_visa_types text[],
  extracted_hourly_rate_min numeric,
  extracted_hourly_rate_max numeric,
  search_rank real
)
language sql
security definer
set search_path = public
as $$
  with query as (
    select websearch_to_tsquery('english', trim(p_query)) as tsq
    where nullif(trim(p_query), '') is not null
  ),
  latest_matches as (
    select distinct on (r.job_id)
      r.job_id::text as lead_id,
      r.profile_id,
      r.created_at as match_created_at,
      r.final_average_score,
      r.score_breakdown
    from public.radar_match_results r
    where r.job_source = 'social'
      and r.created_at >= coalesce(p_since, now() - interval '72 hours')
    order by r.job_id, r.created_at desc
  )
  select
    lm.lead_id,
    lm.profile_id,
    lm.match_created_at,
    lm.final_average_score,
    lm.score_breakdown,
    s.platform,
    s.posted_by_name,
    s.poster_email,
    s.poster_phone,
    s.created_at as social_created_at,
    s.posted_at,
    s.job_title,
    s.company_name,
    s.location,
    s.post_content,
    s.extracted_role_normalized,
    s.employment_type,
    s.seniority_level,
    s.salary_range,
    case
      when s.extracted_skills is null then null
      when jsonb_typeof(s.extracted_skills) = 'array' then array(select jsonb_array_elements_text(s.extracted_skills))
      else null
    end as extracted_skills,
    s.extracted_experience_years,
    case
      when s.extracted_visa_types is null then null
      when jsonb_typeof(s.extracted_visa_types) = 'array' then array(select jsonb_array_elements_text(s.extracted_visa_types))
      else null
    end as extracted_visa_types,
    s.extracted_hourly_rate_min,
    s.extracted_hourly_rate_max,
    ts_rank_cd(s.search_document, query.tsq) as search_rank
  from latest_matches lm
  join public.social_jobs s on s.id::text = lm.lead_id
  join query on true
  where s.search_document @@ query.tsq
  order by search_rank desc, lm.match_created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_pulse_social_feed_fts(text, timestamptz, integer, integer) from public;
grant execute on function public.search_pulse_social_feed_fts(text, timestamptz, integer, integer) to authenticated;
