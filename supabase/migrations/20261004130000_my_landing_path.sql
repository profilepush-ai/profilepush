-- Where a signed-in user lands: AI Match the first time, the Tracker once they
-- have tried AI Match (a run, or a post of their own, which is what gives the
-- Tracker columns to show).
create or replace function public.my_landing_path()
returns text
language sql
stable
security definer
set search_path = public
as $$
  with acc as (
    select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active'
  )
  select case when
    exists (select 1 from public.credit_transactions ct where ct.account_id in (select account_id from acc) and ct.description like 'Usage: ai_match_run%')
    or exists (select 1 from public.social_jobs j where j.created_by_account_id in (select account_id from acc) and j.post_source = 'user_post')
    or exists (select 1 from public.social_hotlist h where h.created_by_account_id in (select account_id from acc) and h.post_source = 'user_post')
  then '/tracker' else '/match' end;
$$;
revoke all on function public.my_landing_path() from public, anon;
grant execute on function public.my_landing_path() to authenticated;
