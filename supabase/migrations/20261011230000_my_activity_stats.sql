/*
# What I've done: the Tracker's top cards

my_activity_stats() is the signed-in account's own activity: matches it got,
how many it watched, resumes sent (or asked for), questions to posters,
saved and passed, this week and in all, a 14-day series for the small bar
charts, and the daily watching streak.
*/

create or replace function public.my_activity_stats(p_tz text default 'UTC')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_acct uuid := public.publisher_account_for_user(auth.uid());
  v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
  v_week timestamptz := now() - interval '7 days';
begin
  if v_acct is null then return null; end if;
  return (
    with c as (select * from public.pipeline_cards where account_id = v_acct),
    d as (select generate_series((now() at time zone v_tz)::date - 13, (now() at time zone v_tz)::date, interval '1 day')::date as day)
    select jsonb_build_object(
      'days', (select jsonb_agg(jsonb_build_object(
          'day', d.day,
          'matches', (select count(*) from c where (c.added_at at time zone v_tz)::date = d.day),
          'watched', (select count(*) from c where (c.viewed_at at time zone v_tz)::date = d.day),
          'applied', (select count(*) from c where (c.applied_at at time zone v_tz)::date = d.day)) order by d.day) from d),
      'week', jsonb_build_object(
          'matches', (select count(*) from c where c.added_at > v_week),
          'watched', (select count(*) from c where c.viewed_at > v_week),
          'applied', (select count(*) from c where c.applied_at > v_week),
          'saved', (select count(*) from c where c.saved_at > v_week),
          'passed', (select count(*) from c where c.closed_reason = 'not_a_match' and c.stage_changed_at > v_week),
          'asked', (select count(*) from public.post_questions q where q.account_id = v_acct and q.created_at > v_week)),
      'all', jsonb_build_object(
          'matches', (select count(*) from c),
          'watched', (select count(*) from c where c.viewed_at is not null),
          'applied', (select count(*) from c where c.applied_at is not null),
          'saved', (select count(*) from c where c.saved_at is not null),
          'asked', (select count(*) from public.post_questions q where q.account_id = v_acct)),
      'streak', public.pp_view_streak(v_acct, v_tz)
    ));
end;
$$;
revoke all on function public.my_activity_stats(text) from public, anon;
grant execute on function public.my_activity_stats(text) to authenticated;
