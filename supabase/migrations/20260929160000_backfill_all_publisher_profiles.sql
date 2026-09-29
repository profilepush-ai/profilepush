-- The first backfill (20260929120000) only read the last 45 days of posts.
-- This one reads every post ever stored, so the Vendors / Bench Recs totals
-- and search cover everyone. Reads only: no post row is written, so no post
-- trigger fires. Existing profiles keep their values; only empty fields and
-- the last-posted dates are filled in.

with jobs as (
  select public.publisher_email_key(j.poster_email) as email,
    (array_agg(trim(j.posted_by_name) order by j.created_at desc) filter (where trim(j.posted_by_name) <> ''))[1] as name,
    (array_agg(trim(j.company_name) order by j.created_at desc) filter (where trim(j.company_name) <> ''))[1] as company,
    (array_agg(trim(j.avatar_url) order by j.created_at desc) filter (where trim(coalesce(j.avatar_url, '')) <> ''))[1] as avatar,
    (array_agg(trim(j.profile_link) order by j.created_at desc) filter (where trim(j.profile_link) <> ''))[1] as linkedin,
    max(coalesce(j.posted_at, j.created_at)) as last_at
  from public.social_jobs j
  where j.poster_email <> ''
  group by 1
)
insert into public.publisher_profiles (email, display_name, company_name, avatar_url, linkedin_url, last_job_post_at)
select email, coalesce(name, ''), coalesce(company, ''), coalesce(avatar, ''), coalesce(linkedin, ''), last_at
from jobs
where position('@' in email) > 0
on conflict (email) do update set
  display_name = case when publisher_profiles.display_name = '' then excluded.display_name else publisher_profiles.display_name end,
  company_name = case when publisher_profiles.company_name = '' then excluded.company_name else publisher_profiles.company_name end,
  avatar_url = case when publisher_profiles.avatar_url = '' then excluded.avatar_url else publisher_profiles.avatar_url end,
  linkedin_url = case when publisher_profiles.linkedin_url = '' then excluded.linkedin_url else publisher_profiles.linkedin_url end,
  last_job_post_at = greatest(publisher_profiles.last_job_post_at, excluded.last_job_post_at);

with hotlists as (
  select public.publisher_email_key(h.bench_sales_recruiter_email) as email,
    (array_agg(trim(h.bench_sales_recruiter_name) order by h.created_at desc) filter (where trim(h.bench_sales_recruiter_name) <> ''))[1] as name,
    (array_agg(trim(h.bench_sales_company_name) order by h.created_at desc) filter (where trim(h.bench_sales_company_name) <> ''))[1] as company,
    (array_agg(trim(h.bench_sales_recruiter_avatar_url) order by h.created_at desc) filter (where trim(coalesce(h.bench_sales_recruiter_avatar_url, '')) <> ''))[1] as avatar,
    (array_agg(trim(h.recruiter_profile_link) order by h.created_at desc) filter (where trim(h.recruiter_profile_link) <> ''))[1] as linkedin,
    max(coalesce(h.posted_at, h.created_at)) as last_at
  from public.social_hotlist h
  where h.bench_sales_recruiter_email <> ''
  group by 1
)
insert into public.publisher_profiles (email, display_name, company_name, avatar_url, linkedin_url, last_hotlist_post_at)
select email, coalesce(name, ''), coalesce(company, ''), coalesce(avatar, ''), coalesce(linkedin, ''), last_at
from hotlists
where position('@' in email) > 0
on conflict (email) do update set
  display_name = case when publisher_profiles.display_name = '' then excluded.display_name else publisher_profiles.display_name end,
  company_name = case when publisher_profiles.company_name = '' then excluded.company_name else publisher_profiles.company_name end,
  avatar_url = case when publisher_profiles.avatar_url = '' then excluded.avatar_url else publisher_profiles.avatar_url end,
  linkedin_url = case when publisher_profiles.linkedin_url = '' then excluded.linkedin_url else publisher_profiles.linkedin_url end,
  last_hotlist_post_at = greatest(publisher_profiles.last_hotlist_post_at, excluded.last_hotlist_post_at);

-- Claim the new profiles whose email already belongs to a confirmed user.
update public.publisher_profiles p
set claimed_account_id = public.publisher_account_for_user(u.id),
    claimed_at = now()
from auth.users u
where p.claimed_account_id is null
  and lower(trim(u.email)) = p.email
  and u.email_confirmed_at is not null
  and public.publisher_account_for_user(u.id) is not null;
