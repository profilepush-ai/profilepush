-- Bound AI Match's view scan to the search window, and make the search exact
-- without relying on ivfflat.probes.
--
-- Measured: the nearest-neighbour step takes ~260ms, but joining its ids back
-- to the feed view took 4.4s, because the view exposes lead_id as id::text and
-- the join cannot use the primary key. Adding the same date bound on the view
-- side turns it into a single window scan with a hash join: 0.6s end to end.

create or replace function public.ai_match_jobs(
  p_embedding extensions.vector(768),
  p_since timestamptz default now() - interval '30 days',
  p_limit integer default 60
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
  effective_posted_at timestamptz,
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
  role_title text,
  core_skills text[],
  years_experience numeric,
  visa_types text[],
  work_type text,
  locations text[],
  hourly_rate_min numeric,
  hourly_rate_max numeric,
  relocation_required boolean,
  post_source text,
  created_by_account_id uuid,
  created_by_user_id uuid,
  author_display_name text,
  avatar_url text,
  similarity double precision
)
language sql
stable
security definer
-- pgvector lives in the extensions schema on this project; without it on the
-- path neither the vector type nor the <=> operator resolves.
set search_path = public, extensions
as $$
  with nearest as (
    -- Rank on the base table, where the embedding lives, then join the view for
    -- the card-shaped row. Over-fetch so the view's eligibility rules and the
    -- de-duplication below still leave p_limit rows.
    select t.id::text as lead_id, 1 - (t.job_embedding <=> p_embedding) as similarity
    from public.social_jobs t
    where t.job_embedding is not null
      and t.hidden_at is null
      and coalesce(t.posted_at, t.created_at) >= coalesce(p_since, now() - interval '30 days')
    -- `+ 0` is deliberate. The embedding index is IVFFlat (lists=50) and
    -- pgvector's default probes=1 would search one list in fifty, silently
    -- dropping most of the best matches. Setting probes per function is
    -- not reliable here (pgvector reserves the ivfflat. prefix, so the
    -- SET is refused depending on session state), so the ordering is
    -- written in a form the index can't serve, forcing an exact scan —
    -- a few hundred ms over the 30-day window.
    order by (t.job_embedding <=> p_embedding) + 0
    limit greatest(1, least(coalesce(p_limit, 60), 200)) * 4
  ),
  eligible as (
    select src.*, nearest.similarity
    from nearest
    join public.pulse_feed_jobs_rows_keyed src on src.lead_id = nearest.lead_id
    -- Redundant with nearest's own date filter, and load-bearing: the view's
    -- lead_id is id::text, so a bare join can't use the primary key and the
    -- planner re-walks the view once per id (4.4s for 240 ids). Bounding the
    -- view to the same window lets it scan once and hash-join (0.6s).
    where src.effective_posted_at >= coalesce(p_since, now() - interval '30 days')
  ),
  -- Same de-duplication as the feed, keeping the closest copy of each listing.
  matched as (
    select *
    from (
      select
        eligible.*,
        row_number() over (
          partition by eligible.dedup_key
          order by eligible.similarity desc, eligible.effective_posted_at desc
        ) as dedup_rank
      from eligible
    ) ranked
    where dedup_rank = 1
  )
  select
    lead_id, profile_id, match_created_at, final_average_score, score_breakdown,
    platform, posted_by_name, poster_email, poster_phone, social_created_at,
    posted_at, effective_posted_at, job_title, company_name, location, post_content,
    extracted_role_normalized, employment_type, seniority_level, salary_range,
    extracted_skills, extracted_experience_years, extracted_visa_types,
    extracted_hourly_rate_min, extracted_hourly_rate_max, role_title, core_skills,
    years_experience, visa_types, work_type, locations, hourly_rate_min,
    hourly_rate_max, relocation_required, post_source, created_by_account_id,
    created_by_user_id, author_display_name, avatar_url, similarity
  from matched
  order by similarity desc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

-- Service role only. The ai-match edge function is the gate: it charges the
-- credit, embeds the description and applies the AI scoring. Granting this to
-- authenticated would let a client skip all three and query the index directly.
revoke all on function public.ai_match_jobs(extensions.vector, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.ai_match_jobs(extensions.vector, timestamptz, integer) to service_role;

create or replace function public.ai_match_hotlist(
  p_embedding extensions.vector(768),
  p_since timestamptz default now() - interval '30 days',
  p_limit integer default 60
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
  effective_posted_at timestamptz,
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
  role_title text,
  core_skills text[],
  years_experience numeric,
  visa_types text[],
  work_type text,
  locations text[],
  hourly_rate_min numeric,
  hourly_rate_max numeric,
  relocation_required boolean,
  post_source text,
  created_by_account_id uuid,
  created_by_user_id uuid,
  author_display_name text,
  avatar_url text,
  similarity double precision
)
language sql
stable
security definer
-- pgvector lives in the extensions schema on this project; without it on the
-- path neither the vector type nor the <=> operator resolves.
set search_path = public, extensions
as $$
  with nearest as (
    -- Rank on the base table, where the embedding lives, then join the view for
    -- the card-shaped row. Over-fetch so the view's eligibility rules and the
    -- de-duplication below still leave p_limit rows.
    select t.id::text as lead_id, 1 - (t.hotlist_embedding <=> p_embedding) as similarity
    from public.social_hotlist t
    where t.hotlist_embedding is not null
      and t.hidden_at is null
      and coalesce(t.posted_at, t.created_at) >= coalesce(p_since, now() - interval '30 days')
    -- `+ 0` is deliberate. The embedding index is IVFFlat (lists=50) and
    -- pgvector's default probes=1 would search one list in fifty, silently
    -- dropping most of the best matches. Setting probes per function is
    -- not reliable here (pgvector reserves the ivfflat. prefix, so the
    -- SET is refused depending on session state), so the ordering is
    -- written in a form the index can't serve, forcing an exact scan —
    -- a few hundred ms over the 30-day window.
    order by (t.hotlist_embedding <=> p_embedding) + 0
    limit greatest(1, least(coalesce(p_limit, 60), 200)) * 4
  ),
  eligible as (
    select src.*, nearest.similarity
    from nearest
    join public.pulse_feed_hotlist_rows_keyed src on src.lead_id = nearest.lead_id
    -- Redundant with nearest's own date filter, and load-bearing: the view's
    -- lead_id is id::text, so a bare join can't use the primary key and the
    -- planner re-walks the view once per id (4.4s for 240 ids). Bounding the
    -- view to the same window lets it scan once and hash-join (0.6s).
    where src.effective_posted_at >= coalesce(p_since, now() - interval '30 days')
  ),
  -- Same de-duplication as the feed, keeping the closest copy of each listing.
  matched as (
    select *
    from (
      select
        eligible.*,
        row_number() over (
          partition by eligible.dedup_key
          order by eligible.similarity desc, eligible.effective_posted_at desc
        ) as dedup_rank
      from eligible
    ) ranked
    where dedup_rank = 1
  )
  select
    lead_id, profile_id, match_created_at, final_average_score, score_breakdown,
    platform, posted_by_name, poster_email, poster_phone, social_created_at,
    posted_at, effective_posted_at, job_title, company_name, location, post_content,
    extracted_role_normalized, employment_type, seniority_level, salary_range,
    extracted_skills, extracted_experience_years, extracted_visa_types,
    extracted_hourly_rate_min, extracted_hourly_rate_max, role_title, core_skills,
    years_experience, visa_types, work_type, locations, hourly_rate_min,
    hourly_rate_max, relocation_required, post_source, created_by_account_id,
    created_by_user_id, author_display_name, avatar_url, similarity
  from matched
  order by similarity desc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

-- Service role only. The ai-match edge function is the gate: it charges the
-- credit, embeds the description and applies the AI scoring. Granting this to
-- authenticated would let a client skip all three and query the index directly.
revoke all on function public.ai_match_hotlist(extensions.vector, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.ai_match_hotlist(extensions.vector, timestamptz, integer) to service_role;
