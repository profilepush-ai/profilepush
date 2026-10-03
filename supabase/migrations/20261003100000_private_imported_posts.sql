-- Imported posts are private. The public profile page (/profile/<slug>) and
-- the sitemap now show only posts made in ProfilePush (post_source
-- 'user_post'); posts that came in carrying the person's email show only in
-- their own My Profile. Running AI Match on one of those saves it as their
-- own post (which is public) and closes the imported copy.

create or replace function public.get_public_publisher_profile(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select * from public.publisher_profiles where slug = p_slug and removed_at is null
  ),
  jobs as (
    select r.lead_id, r.posted_at, j.job_title, j.location, j.employment_type,
           j.extracted_hourly_rate_min as rate_min, j.extracted_hourly_rate_max as rate_max
    from p, public.publisher_recent_posts(array[p.id], 'job', 30) r
    join public.social_jobs j on j.id = r.lead_id
    where j.post_source = 'user_post'
  ),
  hot as (
    select r.lead_id, r.posted_at, r.locations, r.job_types,
      array(
        select x from unnest(r.roles) x
        where x !~* '^\s*name\b' and lower(btrim(x)) <> 'consultant'
          and not exists (
            select 1 from public.social_hotlist h2
            where h2.source_post_id = (select h.source_post_id from public.social_hotlist h where h.id = r.lead_id)
              and nullif(btrim(h2.candidate_name), '') is not null
              and position(lower(btrim(h2.candidate_name)) in lower(x)) > 0
          )
      ) as roles
    from p, public.publisher_recent_posts(array[p.id], 'hotlist', 30) r
    where exists (select 1 from public.social_hotlist hx where hx.id = r.lead_id and hx.post_source = 'user_post')
  )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'slug', (select slug from p),
    'display_name', (select display_name from p),
    'company_name', (select company_name from p),
    'avatar_url', (select avatar_url from p),
    'is_claimed', (select claimed_account_id is not null from p),
    'follower_count', (select count(*) from public.publisher_follows f, p where f.publisher_id = p.id),
    'job_count', (select count(*) from jobs),
    'hotlist_count', (select count(*) from hot),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object('id', lead_id, 'title', job_title, 'location', location, 'employment_type', employment_type,
                                          'rate_min', rate_min, 'rate_max', rate_max, 'posted_at', posted_at) order by posted_at desc)
      from (select * from jobs order by posted_at desc limit 20) t
    ), '[]'::jsonb),
    'hotlists', coalesce((
      select jsonb_agg(jsonb_build_object('id', lead_id, 'roles', to_jsonb(roles[1:6]), 'consultant_count', nullif(cardinality(roles), 0),
                                          'locations', to_jsonb(locations[1:3]), 'posted_at', posted_at) order by posted_at desc)
      from (select * from hot order by posted_at desc limit 20) t
    ), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.get_public_publisher_profile(text) from public;
grant execute on function public.get_public_publisher_profile(text) to anon, authenticated;

create or replace function public.get_public_profile_index()
returns table (slug text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.slug, greatest(p.last_job_post_at, p.last_hotlist_post_at)
  from public.publisher_profiles p
  where p.removed_at is null
    and greatest(p.last_job_post_at, p.last_hotlist_post_at) >= now() - interval '30 days'
    -- Only profiles with something to show: posts made in ProfilePush.
    and (
      exists (select 1 from public.social_jobs j
              where j.post_source = 'user_post' and j.hidden_at is null and coalesce(j.post_status, 'open') = 'open'
                and coalesce(j.poster_email, '') <> '' and public.publisher_email_key(j.poster_email) = p.email
                and j.created_at >= now() - interval '30 days')
      or exists (select 1 from public.social_hotlist h
              where h.post_source = 'user_post' and h.hidden_at is null and coalesce(h.post_status, 'open') = 'open'
                and coalesce(h.bench_sales_recruiter_email, '') <> '' and public.publisher_email_key(h.bench_sales_recruiter_email) = p.email
                and h.created_at >= now() - interval '30 days')
    )
  order by 2 desc
  limit 5000;
$$;

revoke all on function public.get_public_profile_index() from public;
grant execute on function public.get_public_profile_index() to anon, authenticated;
