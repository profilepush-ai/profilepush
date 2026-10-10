/*
# Team dashboard: each recruiter's activity

get_team_activity(days): for the caller's account, each active member's
submissions sent (AI Submit / Today / AI Request), career-site applies, AI
Match runs, posts added and last activity, plus team totals (matches received,
matches left) and a daily series. Owners and admins see every member; others
see only themselves. Free for every account.
*/

create or replace function public.get_team_activity(p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_account uuid;
  v_role text;
  v_since timestamptz := now() - make_interval(days => greatest(1, least(90, p_days)));
  v_result jsonb;
begin
  select am.account_id, am.role into v_account, v_role from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1;
  if v_account is null then return null; end if;

  with members as (
    select am.user_id, am.role, am.created_at,
      coalesce(nullif(btrim(am.display_name), ''), nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email::text, '@', 1)) as name,
      u.email::text as email
    from public.account_members am
    join auth.users u on u.id = am.user_id
    where am.account_id = v_account and am.status = 'active' and am.user_id is not null
      and (v_role in ('owner', 'admin') or am.user_id = auth.uid())
  ),
  sends as (
    select r.user_id, r.created_at from public.pulse_ask_ai_requests r
    where r.account_id = v_account and r.created_at >= v_since and r.status in ('completed', 'fulfilled')
  ),
  applies as (
    select a.user_id, a.created_at from public.external_applications a
    where a.account_id = v_account and a.created_at >= v_since
  ),
  runs as (
    select t.user_id from public.credit_transactions t
    where t.account_id = v_account and t.created_at >= v_since and t.description = 'Usage: ai_match_run'
  ),
  posts as (
    select h.created_by_user_id as user_id from public.social_hotlist h
    where h.created_by_account_id = v_account and h.post_source = 'user_post' and h.created_at >= v_since
    union all
    select j.created_by_user_id from public.social_jobs j
    where j.created_by_account_id = v_account and j.post_source = 'user_post' and j.created_at >= v_since
  ),
  days as (
    select generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day')::date as d
  )
  select jsonb_build_object(
    'days', greatest(1, least(90, p_days)),
    'can_see_all', v_role in ('owner', 'admin'),
    'totals', jsonb_build_object(
      'sends', (select count(*) from sends),
      'applies', (select count(*) from applies),
      'ai_match_runs', (select count(*) from runs),
      'matches_received', (select count(*) from public.pipeline_cards c where c.account_id = v_account and c.added_at >= v_since),
      'matches_left', (select floor(coalesce(a.credits_balance, 0))::int from public.accounts a where a.id = v_account),
      'members', (select count(*) from public.account_members am where am.account_id = v_account and am.status = 'active')
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', m.name, 'email', m.email, 'role', m.role,
        'sends', (select count(*) from sends s where s.user_id = m.user_id),
        'applies', (select count(*) from applies a where a.user_id = m.user_id),
        'ai_match_runs', (select count(*) from runs r where r.user_id = m.user_id),
        'posts', (select count(*) from posts p where p.user_id = m.user_id),
        'last_active', (select max(d.last_activity_at) from public.user_activity_daily d where d.user_id = m.user_id)
      ) order by m.role = 'owner' desc, m.created_at)
      from members m
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', days.d,
        'sends', (select count(*) from sends s where s.created_at::date = days.d),
        'applies', (select count(*) from applies a where a.created_at::date = days.d)
      ) order by days.d)
      from days
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_team_activity(integer) from public, anon;
grant execute on function public.get_team_activity(integer) to authenticated;
