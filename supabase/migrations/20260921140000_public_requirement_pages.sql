-- Public, indexable requirement pages: top 5 scored listings per role x state.
--
-- These pages are for search engines and logged-out visitors, so two rules
-- shape everything below:
--
--   1. No contact details. poster_email and poster_phone are the asset people
--      sign up for, and publishing them would hand the whole list to scrapers
--      and competitors in a week. The public row says a contact exists; it
--      never says who.
--   2. Five rows only. Enough to prove the inventory is real and current,
--      not enough to be a substitute for the product.
--
-- There is no consultant to match against on a public page, so "scored" here
-- cannot mean the AI fit score. It means how good the listing is: fresh,
-- complete, and actionable.

-- Role buckets. Deliberately coarse: a page template needs a term people
-- actually search, not one of the ~4,000 distinct job titles in the feed.
create or replace function public.pp_role_bucket(p_title text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_title ~* '\mjava\M|spring boot'                                then 'java-developer'
    when p_title ~* '\.net|dotnet|\mc#\M'                                 then 'dotnet-developer'
    when p_title ~* 'salesforce'                                          then 'salesforce'
    when p_title ~* 'servicenow'                                          then 'servicenow'
    when p_title ~* 'workday'                                             then 'workday'
    when p_title ~* '\msap\M'                                             then 'sap'
    when p_title ~* '\mqa\M|quality assurance|test(er|ing)|automation engineer' then 'qa-automation'
    when p_title ~* 'business analyst|\mba\M'                             then 'business-analyst'
    when p_title ~* 'project manager|program manager|scrum master'        then 'project-manager'
    when p_title ~* 'data engineer|etl|informatica|snowflake|databricks'  then 'data-engineer'
    when p_title ~* 'data scientist|machine learning|\mml\M'              then 'data-science'
    when p_title ~* 'devops|\msre\M|kubernetes|terraform'                 then 'devops'
    when p_title ~* 'cloud|\maws\M|azure|\mgcp\M'                         then 'cloud-engineer'
    when p_title ~* 'react|angular|front.?end|ui developer'               then 'frontend-react'
    when p_title ~* 'full.?stack'                                         then 'full-stack'
    when p_title ~* 'python'                                              then 'python-developer'
    when p_title ~* 'network|cisco|firewall'                              then 'network-engineer'
    when p_title ~* 'security|cyber|\miam\M'                              then 'security'
    when p_title ~* 'oracle|\mdba\M|database admin'                       then 'oracle-dba'
    when p_title ~* 'android|\mios\M|mobile developer|flutter'            then 'mobile-developer'
    when p_title ~* 'power ?bi|tableau'                                   then 'bi-reporting'
    when p_title ~* 'mainframe|cobol'                                     then 'mainframe'
    when p_title ~* 'architect'                                           then 'architect'
    else ''
  end;
$$;

-- Two-letter state, or REMOTE. Checked before the state names so that a
-- "Remote (TX preferred)" listing files under remote work, which is how people
-- search for it.
create or replace function public.pp_state_code(p_location text)
returns text
language sql
immutable
parallel safe
as $$
  with raw as (select lower(coalesce(p_location, '')) as v)
  select case
    when (select v from raw) ~ 'remote|anywhere|work from home|\mwfh\M' then 'REMOTE'
    when (select v from raw) ~ '\m(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\M'
      then upper((regexp_match((select v from raw), '\m(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\M'))[1])
    when (select v from raw) like '%texas%'        then 'TX'
    when (select v from raw) like '%california%'   then 'CA'
    when (select v from raw) like '%new york%'     then 'NY'
    when (select v from raw) like '%new jersey%'   then 'NJ'
    when (select v from raw) like '%north carolina%' then 'NC'
    when (select v from raw) like '%georgia%'      then 'GA'
    when (select v from raw) like '%illinois%'     then 'IL'
    when (select v from raw) like '%ohio%'         then 'OH'
    when (select v from raw) like '%pennsylvania%' then 'PA'
    when (select v from raw) like '%arizona%'      then 'AZ'
    when (select v from raw) like '%virginia%'     then 'VA'
    when (select v from raw) like '%michigan%'     then 'MI'
    when (select v from raw) like '%washington%'   then 'WA'
    when (select v from raw) like '%florida%'      then 'FL'
    else ''
  end;
$$;

-- Listing quality, 0-100, for pages with no consultant to match against.
-- Recency dominates: a three-week-old requirement is usually filled, and a
-- page of stale listings is worse than no page.
create or replace function public.pp_listing_score(
  p_posted_at timestamptz,
  -- jsonb, not text[]: that is how social_jobs stores it. The feed view casts
  -- it to an array, the base table does not.
  p_skills jsonb,
  p_rate_min numeric,
  p_rate_max numeric,
  p_employment_type text,
  p_location text,
  p_company text
)
returns integer
language sql
immutable
parallel safe
as $$
  select least(100, greatest(0,
      -- Freshness, up to 50
      case
        when p_posted_at is null then 10
        when p_posted_at > now() - interval '2 days'  then 50
        when p_posted_at > now() - interval '5 days'  then 40
        when p_posted_at > now() - interval '10 days' then 28
        when p_posted_at > now() - interval '20 days' then 15
        else 5
      end
      -- Completeness, up to 50: what a recruiter needs to act without asking
      + case when jsonb_typeof(p_skills) = 'array' and jsonb_array_length(p_skills) >= 3 then 18
             when jsonb_typeof(p_skills) = 'array' and jsonb_array_length(p_skills) >= 1 then 10 else 0 end
      + case when p_rate_min is not null or p_rate_max is not null then 12 else 0 end
      + case when coalesce(btrim(p_employment_type), '') <> '' then 8 else 0 end
      + case when coalesce(btrim(p_location), '') <> '' then 7 else 0 end
      + case when coalesce(btrim(p_company), '') <> '' then 5 else 0 end
  ))::integer;
$$;

-- The page itself. Anon-callable by design, and every column it returns is
-- safe to publish: no email, no phone, no post body.
create or replace function public.get_public_requirements(
  p_role text,
  p_state text default null,
  p_limit integer default 5
)
returns table (
  lead_id text,
  job_title text,
  company_name text,
  location text,
  employment_type text,
  skills text[],
  experience_years integer,
  rate_min numeric,
  rate_max numeric,
  posted_at timestamptz,
  listing_score integer,
  has_contact boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with pool as (
    select
      j.id::text as lead_id,
      j.job_title,
      j.company_name,
      j.location,
      j.employment_type,
      case when jsonb_typeof(j.extracted_skills) = 'array'
           then array(select jsonb_array_elements_text(j.extracted_skills))
           else '{}'::text[] end as skills,
      j.extracted_experience_years as experience_years,
      j.extracted_hourly_rate_min as rate_min,
      j.extracted_hourly_rate_max as rate_max,
      coalesce(j.posted_at, j.created_at) as posted_at,
      public.pp_listing_score(
        coalesce(j.posted_at, j.created_at), j.extracted_skills,
        j.extracted_hourly_rate_min, j.extracted_hourly_rate_max,
        j.employment_type, j.location, j.company_name
      ) as listing_score,
      coalesce(btrim(j.poster_email), '') <> '' as has_contact,
      -- One listing per recruiter per title: the same requirement is posted to
      -- several groups, and five near-identical rows looks broken.
      row_number() over (
        partition by coalesce(nullif(lower(btrim(j.poster_email)), ''), j.id::text), lower(btrim(coalesce(j.job_title, '')))
        order by coalesce(j.posted_at, j.created_at) desc
      ) as dedup_rank
    from public.social_jobs j
    where j.hidden_at is null
      and coalesce(j.posted_at, j.created_at) >= now() - interval '30 days'
      -- Nothing without a contact route reaches a public page: it would be a
      -- listing nobody can act on even after signing up.
      and coalesce(btrim(j.poster_email), '') <> ''
      and public.pp_role_bucket(coalesce(j.job_title, '')) = lower(btrim(coalesce(p_role, '')))
      and (
        coalesce(btrim(p_state), '') = ''
        or public.pp_state_code(coalesce(j.location, '')) = upper(btrim(p_state))
      )
  )
  select lead_id, job_title, company_name, location, employment_type, skills,
         experience_years, rate_min, rate_max, posted_at, listing_score, has_contact
  from pool
  where dedup_rank = 1
  order by listing_score desc, posted_at desc
  limit greatest(1, least(coalesce(p_limit, 5), 5));
$$;

-- Counts for the page copy ("142 cloud roles in Texas this month"), which is
-- the part that is genuinely ours rather than a republished listing.
create or replace function public.get_public_requirement_stats(
  p_role text,
  p_state text default null
)
returns table (
  total_30d integer,
  added_7d integer,
  with_rate integer,
  with_contact integer,
  median_rate_max numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with pool as (
    select j.*, coalesce(j.posted_at, j.created_at) as effective_at
    from public.social_jobs j
    where j.hidden_at is null
      and coalesce(j.posted_at, j.created_at) >= now() - interval '30 days'
      and public.pp_role_bucket(coalesce(j.job_title, '')) = lower(btrim(coalesce(p_role, '')))
      and (
        coalesce(btrim(p_state), '') = ''
        or public.pp_state_code(coalesce(j.location, '')) = upper(btrim(p_state))
      )
  )
  select
    count(*)::integer,
    count(*) filter (where effective_at >= now() - interval '7 days')::integer,
    count(*) filter (where extracted_hourly_rate_max is not null)::integer,
    count(*) filter (where coalesce(btrim(poster_email), '') <> '')::integer,
    percentile_cont(0.5) within group (order by extracted_hourly_rate_max)
      filter (where extracted_hourly_rate_max is not null)
  from pool;
$$;

-- Which pages are worth generating at all, so the sitemap is driven by real
-- inventory instead of a hardcoded list that rots.
create or replace function public.get_public_page_index(p_min_listings integer default 20)
returns table (role text, state text, listings integer)
language sql
stable
security definer
set search_path = public
as $$
  select role, state, count(*)::integer as listings
  from (
    select
      public.pp_role_bucket(coalesce(j.job_title, '')) as role,
      public.pp_state_code(coalesce(j.location, '')) as state
    from public.social_jobs j
    where j.hidden_at is null
      and coalesce(j.posted_at, j.created_at) >= now() - interval '30 days'
      and coalesce(btrim(j.poster_email), '') <> ''
  ) classified
  where role <> '' and state <> ''
  group by role, state
  having count(*) >= greatest(1, coalesce(p_min_listings, 20))
  order by count(*) desc;
$$;

grant execute on function public.get_public_requirements(text, text, integer) to anon, authenticated;
grant execute on function public.get_public_requirement_stats(text, text) to anon, authenticated;
grant execute on function public.get_public_page_index(integer) to anon, authenticated;
