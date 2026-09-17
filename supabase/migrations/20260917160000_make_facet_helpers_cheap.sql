-- Make the facet helpers cheap enough to run per row.
--
-- Measured over a 7-day window (~5k rows): the base view scans in 50ms, adding
-- the dedupe key costs ~400ms, but adding just *two* facet functions took
-- 5,966ms. The helpers, not the query shape, were the cost.
--
-- Two things made them expensive, both per row:
--
--   * pulse_first_meaningful ran `unnest(...) WITH ORDINALITY ORDER BY ord
--     LIMIT 1` — a sort and a set-returning function for what is a coalesce
--     over at most five arguments.
--   * pulse_parse_experience_years ran regexp_matches(...,'g') WITH ORDINALITY
--     plus three correlated subqueries over the result.
--
-- Signatures and results are unchanged, so the views and RPCs built on them
-- keep working untouched; only the bodies change.

-- The "is this value meaningful" test, split out so the chain below is a plain
-- coalesce that the planner can inline.
create or replace function public.pulse_meaningful(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when btrim(coalesce(p_value, '')) = '' then null
    when btrim(p_value) = '-' then null
    when lower(btrim(p_value)) = 'not specified' then null
    else btrim(p_value)
  end;
$$;

-- Same contract as before — first meaningful value, '-' when there is none.
-- Every call site passes at most four values; indexing past the end of the
-- array yields NULL, so the extra slots are harmless.
create or replace function public.pulse_first_meaningful(p_values text[])
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(
    public.pulse_meaningful(p_values[1]),
    public.pulse_meaningful(p_values[2]),
    public.pulse_meaningful(p_values[3]),
    public.pulse_meaningful(p_values[4]),
    public.pulse_meaningful(p_values[5]),
    '-'
  );
$$;

-- parseExperienceYears, without the set-returning regex: first number, '+'
-- takes the first, a range averages the first two.
create or replace function public.pulse_parse_experience_years(p_value text)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
    when first_num is null then null
    when position('+' in v) > 0 then first_num
    when position('-' in v) > 0 and second_num is not null then (first_num + second_num) / 2
    else first_num
  end
  from (
    select
      coalesce(p_value, '') as v,
      (substring(coalesce(p_value, '') from '\d+(?:\.\d+)?'))::numeric as first_num,
      ((regexp_match(coalesce(p_value, ''), '\d+(?:\.\d+)?\D+?(\d+(?:\.\d+)?)'))[1])::numeric as second_num
  ) parsed;
$$;

-- parseFirstNumericValue, as a single expression.
create or replace function public.pulse_parse_first_numeric(p_value text)
returns numeric
language sql
immutable
parallel safe
as $$
  select replace(
    substring(coalesce(p_value, '') from '\d+(?:,\d{3})*(?:\.\d+)?'),
    ',', ''
  )::numeric;
$$;
