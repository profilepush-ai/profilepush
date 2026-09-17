-- Facet classification, moved server-side.
--
-- Until now the feed's sidebar facets (work type, employment type, visa,
-- experience) were derived in the browser by getLeadFilterContext in
-- PulsePage.tsx, which only works because the client holds every row in the
-- window. Once the feed pages 100 rows at a time, both the filtering and the
-- counts have to happen in SQL.
--
-- These helpers are a deliberate line-by-line port of that TypeScript so the
-- two can't drift: same fallback order, same substring tests, same precedence.
-- If you change one side, change the other. The ported originals are
-- getBreakdownJobValue, firstMeaningfulValue, normalize, parseExperienceYears
-- and getLeadFilterContext.

-- normalize(): lowercase, trim, collapse internal whitespace.
create or replace function public.pulse_normalize(p_input text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(lower(btrim(coalesce(p_input, ''))), '\s+', ' ', 'g');
$$;

-- getBreakdownJobValue(): score_breakdown -> <key> -> job_value, trimmed.
-- Non-object entries yield '' exactly as the `typeof value !== 'object'`
-- guard does.
create or replace function public.pulse_breakdown_job_value(p_breakdown jsonb, p_key text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_breakdown is null then ''
    when jsonb_typeof(p_breakdown -> p_key) is distinct from 'object' then ''
    else btrim(coalesce(p_breakdown -> p_key ->> 'job_value', ''))
  end;
$$;

-- firstMeaningfulValue(): first value that isn't blank, '-' or 'not
-- specified'; '-' when none qualify. WITH ORDINALITY keeps argument order,
-- which the precedence depends on.
create or replace function public.pulse_first_meaningful(p_values text[])
returns text
language sql
immutable
parallel safe
as $$
  select coalesce((
    select btrim(v)
    from unnest(coalesce(p_values, '{}'::text[])) with ordinality as t(v, ord)
    where btrim(coalesce(v, '')) <> ''
      and btrim(v) <> '-'
      and lower(btrim(v)) <> 'not specified'
    order by ord
    limit 1
  ), '-');
$$;

-- parseExperienceYears(): all numbers in the string; '+' takes the first,
-- a range ('-') averages the first two, otherwise the first.
create or replace function public.pulse_parse_experience_years(p_value text)
returns numeric
language sql
immutable
parallel safe
as $$
  with nums as (
    select (m[1])::numeric as n, ord
    from regexp_matches(coalesce(p_value, ''), '\d+(?:\.\d+)?', 'g') with ordinality as t(m, ord)
  )
  select case
    when (select count(*) from nums) = 0 then null
    when position('+' in coalesce(p_value, '')) > 0
      then (select n from nums order by ord limit 1)
    when position('-' in coalesce(p_value, '')) > 0 and (select count(*) from nums) >= 2
      then (select avg(n) from (select n from nums order by ord limit 2) as first_two)
    else (select n from nums order by ord limit 1)
  end;
$$;

-- work_type_match only, no fallback — matches the `firstMeaningfulValue(x, '')`
-- in getLeadFilterContext.
create or replace function public.pulse_facet_work_type(p_breakdown jsonb)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when v like '%remote%' then 'remote'
    when v like '%hybrid%' then 'hybrid'
    when v like '%onsite%' or v like '%on site%' or v like '%on-site%' then 'onsite'
    else 'other'
  end
  from (
    select public.pulse_normalize(
      public.pulse_first_meaningful(array[public.pulse_breakdown_job_value(p_breakdown, 'work_type_match'), ''])
    ) as v
  ) as t;
$$;

-- Precedence is full -> contract -> c2c -> w2 -> 1099 -> part, and it is
-- load-bearing: "full time contract" classifies as full_time on both sides.
create or replace function public.pulse_facet_employment_type(p_breakdown jsonb, p_employment_type text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when v like '%full%' then 'full_time'
    when v like '%contract%' then 'contract'
    when v like '%c2c%' then 'c2c'
    when v like '%w2%' then 'w2'
    when v like '%1099%' then '1099'
    when v like '%part%' then 'part_time'
    else 'other'
  end
  from (
    select public.pulse_normalize(
      public.pulse_first_meaningful(array[
        public.pulse_breakdown_job_value(p_breakdown, 'employment_type_match'),
        p_employment_type
      ])
    ) as v
  ) as t;
$$;

-- The bare-'gc' equality and the ' gc ' padding test are both carried over
-- verbatim; dropping either reclassifies rows relative to the client.
create or replace function public.pulse_facet_visa_status(p_breakdown jsonb, p_visa_types text[])
returns text
language sql
immutable
parallel safe
as $$
  select case
    when v like '%usc%' or v like '%us citizen%' then 'usc'
    when v like '%green card%' or v = 'gc' or v like '% gc %' then 'gc'
    when v like '%h1b%' or v like '%h-1%' then 'h1b'
    when v like '%ead%' then 'ead'
    when v like '%opt%' then 'opt'
    when v like '%cpt%' then 'cpt'
    when v like '%tn%' then 'tn'
    else 'other'
  end
  from (
    select public.pulse_normalize(
      public.pulse_first_meaningful(array[
        public.pulse_breakdown_job_value(p_breakdown, 'visa_match'),
        coalesce(array_to_string(p_visa_types, ', '), '')
      ])
    ) as v
  ) as t;
$$;

-- `lead.experienceYears ?? parseExperienceYears(text)` — the column wins
-- outright when set, and only then does the text get parsed.
create or replace function public.pulse_facet_experience_years(
  p_breakdown jsonb,
  p_experience_years integer,
  p_seniority text
)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
    when p_experience_years is not null then p_experience_years::numeric
    else public.pulse_parse_experience_years(
      public.pulse_first_meaningful(array[
        public.pulse_breakdown_job_value(p_breakdown, 'experience_match'),
        case when p_experience_years is not null then p_experience_years::text || ' years' else '' end,
        coalesce(p_seniority, '')
      ])
    )
  end;
$$;

-- parseFirstNumericValue(): first number, thousands separators stripped.
-- Distinct from pulse_parse_experience_years, which averages ranges.
create or replace function public.pulse_parse_first_numeric(p_value text)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
    when m is null then null
    else replace(m[1], ',', '')::numeric
  end
  from (select regexp_match(coalesce(p_value, ''), '(\d+(?:,\d{3})*(?:\.\d+)?)') as m) as t;
$$;

-- The rate text the client builds: hourly_rate_match, then the "$min–$max/hr"
-- string SocialLead.hourlyRate is assembled from (en dash, as in PulsePage),
-- then salary_range. hasRate and rateValue both read off this one string, so
-- it is computed once here.
create or replace function public.pulse_facet_rate_text(
  p_breakdown jsonb,
  p_hourly_rate_min numeric,
  p_hourly_rate_max numeric,
  p_salary_range text
)
returns text
language sql
immutable
parallel safe
as $$
  select public.pulse_first_meaningful(array[
    public.pulse_breakdown_job_value(p_breakdown, 'hourly_rate_match'),
    case
      when p_hourly_rate_min is not null or p_hourly_rate_max is not null
        then '$' || coalesce(p_hourly_rate_min::text, '?') || '–$' || coalesce(p_hourly_rate_max::text, '?') || '/hr'
      else ''
    end,
    coalesce(p_salary_range, ''),
    ''
  ]);
$$;

create or replace function public.pulse_facet_rate_value(
  p_breakdown jsonb,
  p_hourly_rate_min numeric,
  p_hourly_rate_max numeric,
  p_salary_range text
)
returns numeric
language sql
immutable
parallel safe
as $$
  select public.pulse_parse_first_numeric(
    public.pulse_facet_rate_text(p_breakdown, p_hourly_rate_min, p_hourly_rate_max, p_salary_range)
  );
$$;

-- hasRate: rateText is neither the '-' sentinel nor literally 'unknown'.
create or replace function public.pulse_facet_has_rate(
  p_breakdown jsonb,
  p_hourly_rate_min numeric,
  p_hourly_rate_max numeric,
  p_salary_range text
)
returns boolean
language sql
immutable
parallel safe
as $$
  select v <> '-' and public.pulse_normalize(v) <> 'unknown'
  from (
    select public.pulse_facet_rate_text(p_breakdown, p_hourly_rate_min, p_hourly_rate_max, p_salary_range) as v
  ) as t;
$$;

create or replace function public.pulse_facet_skills(p_breakdown jsonb, p_skills text[])
returns text
language sql
immutable
parallel safe
as $$
  select public.pulse_normalize(
    public.pulse_first_meaningful(array[
      public.pulse_breakdown_job_value(p_breakdown, 'skills_match'),
      coalesce(array_to_string(p_skills, ', '), ''),
      ''
    ])
  );
$$;

create or replace function public.pulse_facet_location(p_breakdown jsonb, p_location text)
returns text
language sql
immutable
parallel safe
as $$
  select public.pulse_normalize(
    public.pulse_first_meaningful(array[
      public.pulse_breakdown_job_value(p_breakdown, 'location_match'),
      coalesce(p_location, ''),
      ''
    ])
  );
$$;

-- matchesExperienceRange(): the option table lives in PulsePage as
-- EXPERIENCE_RANGE_OPTIONS. A null year count never matches a specific range,
-- and 'all' always matches.
create or replace function public.pulse_experience_range_matches(p_years numeric, p_range_id text)
returns boolean
language sql
immutable
parallel safe
as $$
  select case
    when p_range_id = 'all' then true
    when p_years is null then false
    when p_range_id = '1-3' then p_years >= 1 and p_years <= 3
    when p_range_id = '3-5' then p_years >= 3 and p_years <= 5
    when p_range_id = '5-7' then p_years >= 5 and p_years <= 7
    when p_range_id = '7-9' then p_years >= 7 and p_years <= 9
    when p_range_id = '9-12' then p_years >= 9 and p_years <= 12
    when p_range_id = '12-15' then p_years >= 12 and p_years <= 15
    when p_range_id = '15+' then p_years >= 15
    else true
  end;
$$;

-- Indexes for the paged feed.
--
-- The feed's sort key is (coalesce(posted_at, created_at) desc, id desc) and
-- the keyset predicate compares that same tuple, so it needs an expression
-- index on the expression itself — idx_social_jobs_posted_at is on the bare
-- column and can't serve a coalesce().
create index if not exists idx_social_jobs_effective_posted_at
  on public.social_jobs ((coalesce(posted_at, created_at)) desc, id desc);

create index if not exists idx_social_hotlist_effective_posted_at
  on public.social_hotlist ((coalesce(posted_at, created_at)) desc, id desc);

-- The per-job "latest match" lookup is a correlated (job_id, created_at desc)
-- probe restricted to social rows; partial keeps it small.
create index if not exists idx_radar_match_results_social_job_latest
  on public.radar_match_results (job_id, created_at desc)
  where job_source = 'social';

create index if not exists idx_radar_match_hotlist_latest
  on public.radar_match_hotlist (hotlist_id, created_at desc);
