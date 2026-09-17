-- Evaluate each facet input exactly once.
--
-- Measured over the 30-day window (21k rows):
--   normalize+first_meaningful chain alone   436ms
--   pulse_classify_visa_status alone         226ms
--   pulse_facet_visa_status (the two nested) 3751ms
--
-- The composition cost six times the sum of its parts because Postgres inlines
-- a SQL function by substituting the *argument expression* at every reference
-- to the parameter. pulse_classify_visa_status names its parameter in nine
-- LIKE branches, so the normalize chain was re-run up to nine times per row.
-- The previous migration made these helpers inlinable to avoid per-row call
-- overhead, which was right for the leaf helpers and wrong for these: a
-- classifier that reads its input many times wants the input passed as a
-- value.
--
-- PL/pgSQL functions are never inlined, so the argument is evaluated once at
-- the call. The bodies are otherwise unchanged, and the leaf helpers they are
-- called with stay inlinable SQL.

create or replace function public.pulse_classify_work_type(p_normalized text)
returns text
language plpgsql
immutable
parallel safe
as $$
begin
  return case
    when p_normalized like '%remote%' then 'remote'
    when p_normalized like '%hybrid%' then 'hybrid'
    when p_normalized like '%onsite%' or p_normalized like '%on site%' or p_normalized like '%on-site%' then 'onsite'
    else 'other'
  end;
end;
$$;

create or replace function public.pulse_classify_employment_type(p_normalized text)
returns text
language plpgsql
immutable
parallel safe
as $$
begin
  return case
    when p_normalized like '%full%' then 'full_time'
    when p_normalized like '%contract%' then 'contract'
    when p_normalized like '%c2c%' then 'c2c'
    when p_normalized like '%w2%' then 'w2'
    when p_normalized like '%1099%' then '1099'
    when p_normalized like '%part%' then 'part_time'
    else 'other'
  end;
end;
$$;

create or replace function public.pulse_classify_visa_status(p_normalized text)
returns text
language plpgsql
immutable
parallel safe
as $$
begin
  return case
    when p_normalized like '%usc%' or p_normalized like '%us citizen%' then 'usc'
    when p_normalized like '%green card%' or p_normalized = 'gc' or p_normalized like '% gc %' then 'gc'
    when p_normalized like '%h1b%' or p_normalized like '%h-1%' then 'h1b'
    when p_normalized like '%ead%' then 'ead'
    when p_normalized like '%opt%' then 'opt'
    when p_normalized like '%cpt%' then 'cpt'
    when p_normalized like '%tn%' then 'tn'
    else 'other'
  end;
end;
$$;

-- Same problem: the value was named six times across the branches.
create or replace function public.pulse_parse_experience_years(p_value text)
returns numeric
language plpgsql
immutable
parallel safe
as $$
declare
  v_first numeric;
  v_second numeric;
begin
  v_first := (substring(coalesce(p_value, '') from '\d+(?:\.\d+)?'))::numeric;
  if v_first is null then
    return null;
  end if;
  if position('+' in coalesce(p_value, '')) > 0 then
    return v_first;
  end if;
  if position('-' in coalesce(p_value, '')) > 0 then
    v_second := ((regexp_match(coalesce(p_value, ''), '\d+(?:\.\d+)?\D+?(\d+(?:\.\d+)?)'))[1])::numeric;
    if v_second is not null then
      return (v_first + v_second) / 2;
    end if;
  end if;
  return v_first;
end;
$$;

-- pulse_facet_rate_text was being built twice per call here.
create or replace function public.pulse_facet_has_rate(
  p_breakdown jsonb,
  p_hourly_rate_min numeric,
  p_hourly_rate_max numeric,
  p_salary_range text
)
returns boolean
language plpgsql
immutable
parallel safe
as $$
declare
  v_rate_text text;
begin
  v_rate_text := public.pulse_facet_rate_text(p_breakdown, p_hourly_rate_min, p_hourly_rate_max, p_salary_range);
  return v_rate_text <> '-' and public.pulse_normalize(v_rate_text) <> 'unknown';
end;
$$;

-- pulse_first_meaningful reads each array element twice (the meaningful test
-- and the returned value), so it too is better off not inlined.
create or replace function public.pulse_meaningful(p_value text)
returns text
language plpgsql
immutable
parallel safe
as $$
begin
  if btrim(coalesce(p_value, '')) = '' then return null; end if;
  if btrim(p_value) = '-' then return null; end if;
  if lower(btrim(p_value)) = 'not specified' then return null; end if;
  return btrim(p_value);
end;
$$;
