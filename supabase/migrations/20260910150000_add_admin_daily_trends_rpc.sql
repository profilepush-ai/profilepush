-- Platform-wide (all-accounts) daily trend metrics for the new /admin
-- Trends panel. Mirrors the generate_series + LEFT JOIN day-bucketing
-- pattern already used by the per-account get_account_jobs_funnel_trend /
-- get_account_hotlist_funnel_trend (20260907200000_drop_dead_reveal_breakdown_funnel_stages.sql),
-- but with no auth.uid()/account scoping — this is called only from the
-- admin-trends edge function via the service-role client, gated by the same
-- shared ADMIN_PASSWORD check every other admin-* function already uses.
create or replace function public.get_admin_daily_trends(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_result jsonb;
begin
  v_since := date_trunc('day', now()) - (greatest(1, least(coalesce(p_days, 30), 180)) - 1 || ' days')::interval;

  with days as (
    select d.day from generate_series(v_since, date_trunc('day', now()), interval '1 day') as d(day)
  ),
  daily_signups as (
    select date_trunc('day', created_at) as day, count(*) as n
    from public.accounts where created_at >= v_since group by 1
  ),
  daily_jobs_scraped as (
    select date_trunc('day', created_at) as day, count(*) as n
    from public.social_jobs where post_source = 'linkedin_scrape' and created_at >= v_since group by 1
  ),
  daily_jobs_posted as (
    select date_trunc('day', created_at) as day, count(*) as n
    from public.social_jobs where post_source = 'user_post' and created_at >= v_since group by 1
  ),
  daily_hotlist_scraped as (
    select date_trunc('day', created_at) as day, count(*) as n
    from public.social_hotlist where post_source = 'linkedin_scrape' and created_at >= v_since group by 1
  ),
  daily_hotlist_posted as (
    select date_trunc('day', created_at) as day, count(*) as n
    from public.social_hotlist where post_source = 'user_post' and created_at >= v_since group by 1
  ),
  daily_searches as (
    select date_trunc('day', created_at) as day, count(*) as n
    from public.job_search_history where created_at >= v_since group by 1
  ),
  daily_ai_pitches as (
    select date_trunc('day', created_at) as day, count(*) as n
    from public.pulse_ask_ai_requests where job_id is not null and created_at >= v_since group by 1
  ),
  daily_ai_requests as (
    select date_trunc('day', created_at) as day, count(*) as n
    from public.pulse_ask_ai_requests where hotlist_id is not null and created_at >= v_since group by 1
  ),
  daily_chats as (
    select date_trunc('day', created_at) as day, count(*) as n
    from public.post_chat_messages where created_at >= v_since group by 1
  )
  select jsonb_build_object(
    'signups_total', (select coalesce(sum(n), 0) from daily_signups),
    'jobs_scraped_total', (select coalesce(sum(n), 0) from daily_jobs_scraped),
    'jobs_posted_total', (select coalesce(sum(n), 0) from daily_jobs_posted),
    'hotlist_scraped_total', (select coalesce(sum(n), 0) from daily_hotlist_scraped),
    'hotlist_posted_total', (select coalesce(sum(n), 0) from daily_hotlist_posted),
    'searches_total', (select coalesce(sum(n), 0) from daily_searches),
    'ai_pitches_total', (select coalesce(sum(n), 0) from daily_ai_pitches),
    'ai_requests_total', (select coalesce(sum(n), 0) from daily_ai_requests),
    'chats_total', (select coalesce(sum(n), 0) from daily_chats),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', to_char(days.day, 'YYYY-MM-DD'),
        'signups', coalesce(ds.n, 0),
        'jobs_scraped', coalesce(djs.n, 0),
        'jobs_posted', coalesce(djp.n, 0),
        'hotlist_scraped', coalesce(dhs.n, 0),
        'hotlist_posted', coalesce(dhp.n, 0),
        'searches', coalesce(dse.n, 0),
        'ai_pitches', coalesce(dap.n, 0),
        'ai_requests', coalesce(dar.n, 0),
        'chats', coalesce(dc.n, 0)
      ) order by days.day), '[]'::jsonb)
      from days
      left join daily_signups ds on ds.day = days.day
      left join daily_jobs_scraped djs on djs.day = days.day
      left join daily_jobs_posted djp on djp.day = days.day
      left join daily_hotlist_scraped dhs on dhs.day = days.day
      left join daily_hotlist_posted dhp on dhp.day = days.day
      left join daily_searches dse on dse.day = days.day
      left join daily_ai_pitches dap on dap.day = days.day
      left join daily_ai_requests dar on dar.day = days.day
      left join daily_chats dc on dc.day = days.day
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_admin_daily_trends(integer) from public;
grant execute on function public.get_admin_daily_trends(integer) to service_role;
