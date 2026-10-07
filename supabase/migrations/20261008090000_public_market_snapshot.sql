-- Public market snapshot for the marketing pages (/, /vendors, /bench-sales).
--
-- The pages show live counts of requirements and hotlist consultants, and
-- animate the newest 40 of each. They are public (anon), so this function
-- returns an anonymised projection only: role titles, skills, experience,
-- employment / work type, visa, city and time. Never names, emails, phone
-- numbers, companies, posters, links or ids. Text fields are also scrubbed of
-- anything that looks like an email address or a phone number, in case one
-- was extracted into a title or a skill.
--
-- Shape:
--   { stats:   { jobs24h, jobs7d, jobs30d, jobsAll, hot24h, hot7d, hot30d, hotAll },
--     jobs:    [ { title, loc, type, skills[<=4], exp, at } x <=40 ],
--     hotlist: [ { title, skills[<=4], exp, visa, work, loc, at } x <=40 ],
--     asOf:    'YYYY-MM-DD' (US Eastern) }
--
-- The client caches the answer for ten minutes per tab and falls back to the
-- snapshot bundled with the build if this call fails.

create or replace function public.pp_public_scrub(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    coalesce(p, ''),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '', 'g'),          -- emails
    '(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}', '', 'g'),        -- US phone numbers
    '\(\s*\)|\[\s*\]', '', 'g'),                                         -- brackets left empty
    '\s{2,}', ' ', 'g'))
$$;

create or replace function public.public_market_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'stats', (
      select jsonb_build_object(
        'jobs24h', count(*) filter (where j.created_at > now() - interval '24 hours'),
        'jobs7d',  count(*) filter (where j.created_at > now() - interval '7 days'),
        'jobs30d', count(*) filter (where j.created_at > now() - interval '30 days'),
        'jobsAll', count(*)
      )
      from public.social_jobs j
      where j.hidden_at is null
    ) || (
      select jsonb_build_object(
        'hot24h', count(*) filter (where h.created_at > now() - interval '24 hours'),
        'hot7d',  count(*) filter (where h.created_at > now() - interval '7 days'),
        'hot30d', count(*) filter (where h.created_at > now() - interval '30 days'),
        'hotAll', count(*)
      )
      from public.social_hotlist h
      where h.hidden_at is null
    ),
    'jobs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'title',  public.pp_public_scrub(j.job_title),
          'loc',    public.pp_public_scrub(j.location),
          'type',   public.pp_public_scrub(j.employment_type),
          'skills', coalesce((
            select jsonb_agg(public.pp_public_scrub(s.v) order by s.n)
            from jsonb_array_elements_text(
              case when jsonb_typeof(j.extracted_skills) = 'array' then j.extracted_skills else '[]'::jsonb end
            ) with ordinality as s(v, n)
            where s.n <= 4
          ), '[]'::jsonb),
          'exp',    j.extracted_experience_years,
          'at',     coalesce(j.posted_at, j.created_at)
        )
        order by j.created_at desc
      )
      from (
        select job_title, location, employment_type, extracted_skills, extracted_experience_years, posted_at, created_at
        from public.social_jobs
        where hidden_at is null
          and job_title is not null
          and btrim(job_title) <> ''
        order by created_at desc
        limit 40
      ) j
    ), '[]'::jsonb),
    'hotlist', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'title',  public.pp_public_scrub(h.role_title),
          'skills', coalesce((
            select jsonb_agg(public.pp_public_scrub(s.v) order by s.n)
            from unnest(h.core_skills) with ordinality as s(v, n)
            where s.n <= 4
          ), '[]'::jsonb),
          'exp',    case when h.years_experience is not null then round(h.years_experience)::int end,
          'visa',   public.pp_public_scrub(h.visa_type),
          'work',   public.pp_public_scrub(h.work_type),
          'loc',    public.pp_public_scrub(h.locations[1]),
          'at',     coalesce(h.posted_at, h.created_at)
        )
        order by h.created_at desc
      )
      from (
        select role_title, core_skills, years_experience, visa_type, work_type, locations, posted_at, created_at
        from public.social_hotlist
        where hidden_at is null
          and role_title is not null
          and btrim(role_title) <> ''
        order by created_at desc
        limit 40
      ) h
    ), '[]'::jsonb),
    'asOf', to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD')
  );
$$;

revoke all on function public.public_market_snapshot() from public;
grant execute on function public.public_market_snapshot() to anon, authenticated;
