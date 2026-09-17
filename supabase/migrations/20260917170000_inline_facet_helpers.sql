-- Make the facet helpers inlinable.
--
-- Measured per 7-day window (~5k rows):
--   count(*)                                  ~60ms
--   count(pulse_breakdown_job_value(...))     ~61ms
--   count(pulse_normalize(...))               ~62ms
--   count(pulse_facet_work_type(...))       ~3166ms
--
-- The pieces are cheap; the composition was not. Postgres inlines a SQL
-- function only when its body is a single expression — a `FROM (select ...)`
-- wrapper, which several of these used to name an intermediate value, blocks
-- inlining and makes every row pay a full function invocation with its own
-- executor setup. That, not the regexes, is where the feed's seconds went.
--
-- These bodies are now single expressions. Where an intermediate was needed,
-- it becomes a separate (also inlinable) classify_* helper taking the already
-- normalised text, so the chain is still evaluated once. Signatures and
-- results are unchanged.

create or replace function public.pulse_classify_work_type(p_normalized text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_normalized like '%remote%' then 'remote'
    when p_normalized like '%hybrid%' then 'hybrid'
    when p_normalized like '%onsite%' or p_normalized like '%on site%' or p_normalized like '%on-site%' then 'onsite'
    else 'other'
  end;
$$;

create or replace function public.pulse_facet_work_type(p_breakdown jsonb)
returns text
language sql
immutable
parallel safe
as $$
  select public.pulse_classify_work_type(
    public.pulse_normalize(
      public.pulse_first_meaningful(array[public.pulse_breakdown_job_value(p_breakdown, 'work_type_match'), ''])
    )
  );
$$;

create or replace function public.pulse_classify_employment_type(p_normalized text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_normalized like '%full%' then 'full_time'
    when p_normalized like '%contract%' then 'contract'
    when p_normalized like '%c2c%' then 'c2c'
    when p_normalized like '%w2%' then 'w2'
    when p_normalized like '%1099%' then '1099'
    when p_normalized like '%part%' then 'part_time'
    else 'other'
  end;
$$;

create or replace function public.pulse_facet_employment_type(p_breakdown jsonb, p_employment_type text)
returns text
language sql
immutable
parallel safe
as $$
  select public.pulse_classify_employment_type(
    public.pulse_normalize(
      public.pulse_first_meaningful(array[
        public.pulse_breakdown_job_value(p_breakdown, 'employment_type_match'),
        p_employment_type
      ])
    )
  );
$$;

create or replace function public.pulse_classify_visa_status(p_normalized text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_normalized like '%usc%' or p_normalized like '%us citizen%' then 'usc'
    when p_normalized like '%green card%' or p_normalized = 'gc' or p_normalized like '% gc %' then 'gc'
    when p_normalized like '%h1b%' or p_normalized like '%h-1%' then 'h1b'
    when p_normalized like '%ead%' then 'ead'
    when p_normalized like '%opt%' then 'opt'
    when p_normalized like '%cpt%' then 'cpt'
    when p_normalized like '%tn%' then 'tn'
    else 'other'
  end;
$$;

create or replace function public.pulse_facet_visa_status(p_breakdown jsonb, p_visa_types text[])
returns text
language sql
immutable
parallel safe
as $$
  select public.pulse_classify_visa_status(
    public.pulse_normalize(
      public.pulse_first_meaningful(array[
        public.pulse_breakdown_job_value(p_breakdown, 'visa_match'),
        coalesce(array_to_string(p_visa_types, ', '), '')
      ])
    )
  );
$$;

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
  select public.pulse_facet_rate_text(p_breakdown, p_hourly_rate_min, p_hourly_rate_max, p_salary_range) <> '-'
    and public.pulse_normalize(
      public.pulse_facet_rate_text(p_breakdown, p_hourly_rate_min, p_hourly_rate_max, p_salary_range)
    ) <> 'unknown';
$$;

-- parseExperienceYears as one expression. The repeated substring() calls are
-- far cheaper than the FROM wrapper they replace, because the whole thing now
-- folds into the calling query.
create or replace function public.pulse_parse_experience_years(p_value text)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
    when substring(coalesce(p_value, '') from '\d+(?:\.\d+)?') is null then null
    when position('+' in coalesce(p_value, '')) > 0
      then (substring(coalesce(p_value, '') from '\d+(?:\.\d+)?'))::numeric
    when position('-' in coalesce(p_value, '')) > 0
      and (regexp_match(coalesce(p_value, ''), '\d+(?:\.\d+)?\D+?(\d+(?:\.\d+)?)'))[1] is not null
      then (
        (substring(coalesce(p_value, '') from '\d+(?:\.\d+)?'))::numeric
        + ((regexp_match(coalesce(p_value, ''), '\d+(?:\.\d+)?\D+?(\d+(?:\.\d+)?)'))[1])::numeric
      ) / 2
    else (substring(coalesce(p_value, '') from '\d+(?:\.\d+)?'))::numeric
  end;
$$;

-- Same for the dedupe key, which also carried a FROM wrapper.
create or replace function public.pulse_lead_dedup_key(
  p_job_title text,
  p_extracted_role_normalized text,
  p_post_content text,
  p_company_name text,
  p_location text,
  p_platform text,
  p_is_hotlist boolean,
  p_poster_email text,
  p_poster_name text,
  p_score_breakdown jsonb,
  p_lead_id text
)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_is_hotlist then array_to_string(array[
      coalesce(public.pulse_dedupe_text(public.pulse_lead_title(p_job_title, p_extracted_role_normalized, p_post_content, true)), ''),
      coalesce(public.pulse_dedupe_text(coalesce(p_company_name, '')), ''),
      coalesce(nullif(public.pulse_dedupe_text(coalesce(nullif(btrim(coalesce(p_location, '')), ''), 'Location not specified')), ''), '-'),
      coalesce(nullif(public.pulse_dedupe_text(coalesce(p_platform, '')), ''), '-'),
      coalesce(
        nullif(public.pulse_dedupe_text(coalesce(p_poster_email, '')), ''),
        nullif(public.pulse_dedupe_text(coalesce(p_poster_name, '')), ''),
        '-'
      ),
      case
        when jsonb_typeof(p_score_breakdown -> 'hotlist_source') = 'object'
         and (p_score_breakdown -> 'hotlist_source' ->> 'candidate_index') ~ '^-?\d+$'
        then p_score_breakdown -> 'hotlist_source' ->> 'candidate_index'
        else coalesce(p_lead_id, '')
      end
    ], '|')
    else array_to_string(array[
      coalesce(public.pulse_dedupe_text(public.pulse_lead_title(p_job_title, p_extracted_role_normalized, p_post_content, false)), ''),
      coalesce(public.pulse_dedupe_text(coalesce(p_company_name, '')), ''),
      coalesce(nullif(public.pulse_dedupe_text(coalesce(nullif(btrim(coalesce(p_location, '')), ''), 'Location not specified')), ''), '-'),
      coalesce(nullif(public.pulse_dedupe_text(coalesce(p_platform, '')), ''), '-')
    ], '|')
  end;
$$;
