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
    ),
    'replies_today', (
      select count(*) from public.vendor_messages m
      join public.vendor_conversations c on c.id = m.conversation_id
      where c.account_id = p_account_id
        and m.direction = 'inbound'
        and m.created_at >= v_today_start
    ),
    'total_vendors_today', (
      select count(distinct coalesce(nullif(poster_email, ''), company_name))
      from public.social_jobs
      where created_at >= v_today_start
        and (coalesce(nullif(poster_email, ''), company_name)) is not null
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
      ),
      'replies_today', (
        select count(*) from public.vendor_messages m
        join public.vendor_conversations c on c.id = m.conversation_id
        where c.account_id = p_account_id
          and c.user_id = member.user_id
          and m.direction = 'inbound'
          and m.created_at >= v_today_start
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
