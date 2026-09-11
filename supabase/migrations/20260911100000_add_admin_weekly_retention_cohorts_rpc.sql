-- Weekly cohort retention grid for the /admin Trends panel: rows are
-- signup weeks (accounts.created_at, ISO week via date_trunc('week', ...)),
-- columns are weeks-since-signup, cells are the % of that cohort with at
-- least one public.user_activity_daily row in that week.
--
-- Week 0 is deliberately NOT forced to 100% — it's computed the same way as
-- every other column (real activity in that week), so it doubles as an
-- "activation rate" (did they actually use the product during their signup
-- week, not just create an account) rather than being a trivial definition.
create or replace function public.get_admin_weekly_retention_cohorts(p_weeks integer default 12)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_result jsonb;
begin
  v_since := date_trunc('week', now()) - (greatest(1, least(coalesce(p_weeks, 12), 26)) - 1 || ' weeks')::interval;

  with cohorts as (
    select id as account_id, date_trunc('week', created_at) as cohort_week
    from public.accounts
    where created_at >= v_since
  ),
  cohort_sizes as (
    select cohort_week, count(*) as size from cohorts group by 1
  ),
  activity_weeks as (
    select distinct uad.account_id, date_trunc('week', uad.activity_date) as activity_week
    from public.user_activity_daily uad
    join cohorts c on c.account_id = uad.account_id
  ),
  retained as (
    select
      c.cohort_week,
      floor(extract(epoch from (a.activity_week - c.cohort_week)) / (7 * 86400))::integer as week_number,
      count(distinct a.account_id) as n
    from cohorts c
    join activity_weeks a on a.account_id = c.account_id and a.activity_week >= c.cohort_week
    group by 1, 2
  )
  select jsonb_build_object(
    'cohorts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'cohort_week', to_char(cs.cohort_week, 'YYYY-MM-DD'),
        'size', cs.size,
        'weeks', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'week_number', r.week_number,
            'retained', r.n,
            'pct', round(r.n::numeric / cs.size * 100, 1)
          ) order by r.week_number), '[]'::jsonb)
          from retained r where r.cohort_week = cs.cohort_week
        )
      ) order by cs.cohort_week desc), '[]'::jsonb)
      from cohort_sizes cs
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_admin_weekly_retention_cohorts(integer) from public;
grant execute on function public.get_admin_weekly_retention_cohorts(integer) to service_role;
