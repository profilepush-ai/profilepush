-- social_jobs.account_id is only set "if the webhook includes it" and is not how
-- job visibility actually works — the Jobs/Pulse feed is a shared, platform-wide
-- firehose (get_pulse_social_feed_page has no account filter at all). Scoping
-- "new jobs today" by account_id was wrong and undercounted; it should be the
-- platform-wide count, same scope as the feed itself. Submissions/predictions
-- stay account-scoped since those tables track real per-account actions.
create or replace function public.get_pulse_dashboard_stats(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_member boolean;
  v_today_start timestamptz := date_trunc('day', now());
  v_summary jsonb;
  v_by_user jsonb;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  select exists (
    select 1 from public.account_members
    where account_id = p_account_id
      and user_id = auth.uid()
      and status = 'active'
  ) into v_is_member;

  if not v_is_member then
    raise exception 'Unauthorized';
  end if;

  select jsonb_build_object(
    'submissions_today', (
      select count(*) from public.pulse_ask_ai_requests
      where account_id = p_account_id
        and job_id is not null
        and status = 'completed'
        and created_at >= v_today_start
    ),
    'new_jobs_today', (
      select count(*) from public.social_jobs
      where created_at >= v_today_start
    ),
    'avg_prediction_score_today', (
      select coalesce(round(avg(score), 1), 0) from public.pulse_predict_logs
      where account_id = p_account_id
        and created_at >= v_today_start
    ),
    'predictions_made_today', (
      select count(*) from public.pulse_predict_logs
      where account_id = p_account_id
        and created_at >= v_today_start
    )
  ) into v_summary;

  select coalesce(jsonb_agg(row_data order by row_data->>'display_name'), '[]'::jsonb) into v_by_user
  from (
    select jsonb_build_object(
      'user_id', member.user_id,
      'display_name', coalesce(nullif(member.display_name, ''), split_part(member.invited_email, '@', 1), 'Member'),
      'submissions_today', (
        select count(*) from public.pulse_ask_ai_requests r
        where r.account_id = p_account_id
          and r.user_id = member.user_id
          and r.job_id is not null
          and r.status = 'completed'
          and r.created_at >= v_today_start
      ),
      'jobs_submitted_today', (
        select count(distinct r.job_id) from public.pulse_ask_ai_requests r
        where r.account_id = p_account_id
          and r.user_id = member.user_id
          and r.job_id is not null
          and r.status = 'completed'
          and r.created_at >= v_today_start
      ),
      'avg_prediction_score_today', (
        select coalesce(round(avg(p.score), 1), 0) from public.pulse_predict_logs p
        where p.account_id = p_account_id
          and p.user_id = member.user_id
          and p.created_at >= v_today_start
      ),
      'predictions_made_today', (
        select count(*) from public.pulse_predict_logs p
        where p.account_id = p_account_id
          and p.user_id = member.user_id
          and p.created_at >= v_today_start
      )
    ) as row_data
    from public.account_members member
    where member.account_id = p_account_id
      and member.status = 'active'
      and member.user_id is not null
  ) sub;

  return v_summary || jsonb_build_object('by_user', v_by_user);
end;
$$;
