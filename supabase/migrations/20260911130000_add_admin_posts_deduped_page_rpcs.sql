-- Powers the /admin Post Outreach table: same recruiter/vendor frequently
-- posts the identical requirement or consultant to multiple LinkedIn/social
-- groups, creating several near-duplicate rows per profile. Dedupe by the
-- poster's own profile link, keeping only their most recent post in range,
-- so the outreach list (and comment generation) targets one row per person
-- rather than repeating the same profile several times.
--
-- Falls back to the post's own id as the dedup key when profile_link is
-- blank (common scraping data-quality gap) — grouping every blank-profile
-- post into one bucket would wrongly collapse unrelated posters together.
create or replace function public.get_admin_job_posts_page(
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table(
  id uuid, post_url text, content text, title text, company text, created_at timestamptz, total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with filtered as (
    select sj.id, sj.post_url, sj.post_content as content, sj.job_title as title,
           sj.company_name as company, sj.created_at, sj.profile_link
    from public.social_jobs sj
    where sj.post_source = 'linkedin_scrape'
      and (p_start_date is null or sj.created_at >= p_start_date)
      and (p_end_date is null or sj.created_at <= p_end_date)
  ),
  deduped as (
    select distinct on (coalesce(nullif(trim(profile_link), ''), id::text))
      id, post_url, content, title, company, created_at
    from filtered
    order by coalesce(nullif(trim(profile_link), ''), id::text), created_at desc
  ),
  counted as (
    select count(*) as total_count from deduped
  )
  select d.id, d.post_url, d.content, d.title, d.company, d.created_at, c.total_count
  from deduped d, counted c
  order by d.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.get_admin_job_posts_page(timestamptz, timestamptz, integer, integer) from public;
grant execute on function public.get_admin_job_posts_page(timestamptz, timestamptz, integer, integer) to service_role;

create or replace function public.get_admin_hotlist_posts_page(
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table(
  id uuid, post_url text, content text, title text, company text, created_at timestamptz, total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with filtered as (
    select sh.id, sh.post_url, sh.raw_post_content as content, sh.role_title as title,
           sh.bench_sales_company_name as company, sh.created_at, sh.recruiter_profile_link
    from public.social_hotlist sh
    where sh.post_source = 'linkedin_scrape'
      and (p_start_date is null or sh.created_at >= p_start_date)
      and (p_end_date is null or sh.created_at <= p_end_date)
  ),
  deduped as (
    select distinct on (coalesce(nullif(trim(recruiter_profile_link), ''), id::text))
      id, post_url, content, title, company, created_at
    from filtered
    order by coalesce(nullif(trim(recruiter_profile_link), ''), id::text), created_at desc
  ),
  counted as (
    select count(*) as total_count from deduped
  )
  select d.id, d.post_url, d.content, d.title, d.company, d.created_at, c.total_count
  from deduped d, counted c
  order by d.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.get_admin_hotlist_posts_page(timestamptz, timestamptz, integer, integer) from public;
grant execute on function public.get_admin_hotlist_posts_page(timestamptz, timestamptz, integer, integer) to service_role;
