-- Restrict the daily digest to users who have actually used the product in
-- the last 7 days (per public.user_activity_daily, the heartbeat-based
-- activity table populated by track_user_activity()/UserActivityTracker.tsx)
-- rather than every active team member regardless of engagement. Reduces
-- digest volume through the shared GMass mailbox (Insights@profilepush.ai)
-- to genuinely engaged recipients, on the same mailbox that already hit
-- Google's daily sending limit once this week.
create or replace function public.get_daily_digest_recipients()
returns table(user_id uuid, email text, account_id uuid)
language sql
security definer
set search_path = public, auth
as $$
  select distinct on (u.id) u.id as user_id, u.email, am.account_id
  from auth.users u
  join account_members am on am.user_id = u.id
  where am.status = 'active'
    and u.email is not null
    and exists (
      select 1 from public.user_activity_daily uad
      where uad.user_id = u.id
        and uad.activity_date >= (current_date - 7)
    )
    and not exists (
      select 1 from notification_preferences np
      where np.user_id = u.id
        and np.notif_type = 'daily_digest'
        and np.email_enabled = false
    )
  order by u.id, am.created_at asc;
$$;

revoke all on function public.get_daily_digest_recipients() from public;
grant execute on function public.get_daily_digest_recipients() to service_role;
