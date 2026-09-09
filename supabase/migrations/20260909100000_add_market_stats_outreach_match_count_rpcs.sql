-- The market-stats-outreach pitch is changing from "N similar posts exist"
-- to a cross-match claim: a vendor (job poster) is told how many hotlist
-- profiles match their job, a bench-sales recruiter (hotlist poster) is told
-- how many jobs match their consultant post. There is no existing table that
-- records job<->hotlist pairs (radar_match_results/radar_match_hotlist are
-- both one-row-per-source-post extraction records, never referencing the
-- other table), and social_hotlist has no embedding column to compare
-- against social_jobs.job_embedding. So both directions use a symmetric
-- text/skills-overlap heuristic rather than mixing an embedding-based count
-- for one side with a heuristic for the other, which would make the two
-- pitches inconsistent in quality/meaning.
--
-- A short role_key (e.g. "IT", "QA") would substring-match almost anything,
-- so the substring fallback only kicks in once the normalized role is at
-- least 3 characters — exact match is always attempted regardless of length.

create index if not exists idx_social_jobs_posted_at
  on public.social_jobs (posted_at desc nulls last, created_at desc);

create or replace function public.count_matching_hotlist_profiles_for_job(
  p_job_id uuid,
  p_window_days integer default 7
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select
      lower(trim(coalesce(sj.extracted_role_normalized, sj.job_title, ''))) as role_key,
      array(
        select lower(trim(skill))
        from jsonb_array_elements_text(coalesce(sj.extracted_skills, '[]'::jsonb)) as skill
        where trim(skill) <> ''
      ) as skills
    from public.social_jobs sj
    where sj.id = p_job_id
  )
  select count(distinct sh.id)::integer
  from public.social_hotlist sh, target t
  where coalesce(sh.posted_at, sh.created_at) >= now() - (greatest(1, coalesce(p_window_days, 7)) || ' days')::interval
    and t.role_key <> ''
    and (
      lower(trim(sh.role_title)) = t.role_key
      or (length(t.role_key) >= 3 and lower(trim(sh.role_title)) like '%' || t.role_key || '%')
      or (length(t.role_key) >= 3 and length(trim(sh.role_title)) >= 3 and t.role_key like '%' || lower(trim(sh.role_title)) || '%')
      or exists (
        select 1 from unnest(sh.core_skills) as skill
        where lower(trim(skill)) = any(t.skills)
      )
    );
$$;

revoke all on function public.count_matching_hotlist_profiles_for_job(uuid, integer) from public;
grant execute on function public.count_matching_hotlist_profiles_for_job(uuid, integer) to service_role;

create or replace function public.count_matching_jobs_for_hotlist(
  p_hotlist_id uuid,
  p_window_days integer default 7
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select
      lower(trim(coalesce(sh.role_title, ''))) as role_key,
      array(
        select lower(trim(skill))
        from unnest(coalesce(sh.core_skills, '{}'::text[])) as skill
        where trim(skill) <> ''
      ) as skills
    from public.social_hotlist sh
    where sh.id = p_hotlist_id
  )
  select count(distinct sj.id)::integer
  from public.social_jobs sj, target t
  where coalesce(sj.posted_at, sj.created_at) >= now() - (greatest(1, coalesce(p_window_days, 7)) || ' days')::interval
    and t.role_key <> ''
    and (
      lower(trim(coalesce(sj.extracted_role_normalized, sj.job_title, ''))) = t.role_key
      or (length(t.role_key) >= 3 and lower(trim(coalesce(sj.extracted_role_normalized, sj.job_title, ''))) like '%' || t.role_key || '%')
      or (length(t.role_key) >= 3 and length(trim(coalesce(sj.extracted_role_normalized, sj.job_title, ''))) >= 3 and t.role_key like '%' || lower(trim(coalesce(sj.extracted_role_normalized, sj.job_title, ''))) || '%')
      or exists (
        select 1 from jsonb_array_elements_text(coalesce(sj.extracted_skills, '[]'::jsonb)) as skill
        where lower(trim(skill)) = any(t.skills)
      )
    );
$$;

revoke all on function public.count_matching_jobs_for_hotlist(uuid, integer) from public;
grant execute on function public.count_matching_jobs_for_hotlist(uuid, integer) to service_role;
