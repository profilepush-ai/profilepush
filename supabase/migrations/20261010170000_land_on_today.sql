/*
# Land on Today when the account has posted consultants

Signing in goes to /home, which asks my_landing_path(). An account with an
open hotlist it posted itself now lands on /today (its consultants' matches
to submit). Otherwise unchanged: the Tracker once the account has used AI
Match or posted, AI Match the first time. The app keeps phones on the
Tracker, since Today is desktop-only for now.
*/
create or replace function public.my_landing_path()
returns text language sql stable security definer set search_path to 'public' as $$
  with acc as (
    select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active'
  )
  select case
    when exists (
      select 1 from public.social_hotlist h
      where h.created_by_account_id in (select account_id from acc) and h.post_source = 'user_post'
        and coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null
    ) then '/today'
    when exists (select 1 from public.credit_transactions ct where ct.account_id in (select account_id from acc) and ct.description like 'Usage: ai_match_run%')
      or exists (select 1 from public.social_jobs j where j.created_by_account_id in (select account_id from acc) and j.post_source = 'user_post')
      or exists (select 1 from public.social_hotlist h where h.created_by_account_id in (select account_id from acc) and h.post_source = 'user_post')
    then '/tracker'
    else '/match'
  end;
$$;
