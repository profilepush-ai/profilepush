-- Backs the new onboarding checklist widget: three booleans for the
-- current user's account — browsed (viewed at least one listing), posted
-- (created a job or hotlist post), asked AI (sent at least one AI outreach
-- pitch/request). Scoped to auth.uid()'s active account membership, same
-- pattern as get_account_jobs_funnel_trend.
create or replace function public.get_my_onboarding_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  select am.account_id into v_account_id
  from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active'
  order by am.created_at asc
  limit 1;

  if v_account_id is null then
    raise exception 'No active account membership found';
  end if;

  select jsonb_build_object(
    'browsed', exists(
      select 1 from public.pulse_lead_actions
      where account_id = v_account_id and action_type = 'post_content_viewed'
    ),
    'posted', exists(
      select 1 from public.social_jobs
      where created_by_account_id = v_account_id and post_source = 'user_post'
      union all
      select 1 from public.social_hotlist
      where created_by_account_id = v_account_id and post_source = 'user_post'
    ),
    'ai_outreach', exists(
      select 1 from public.pulse_ask_ai_requests where account_id = v_account_id
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_my_onboarding_status() from public;
grant execute on function public.get_my_onboarding_status() to authenticated;
