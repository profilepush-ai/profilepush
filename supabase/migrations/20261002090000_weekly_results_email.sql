-- Weekly results email: each user's last 7 days on ProfilePush.
--
-- The email worker sends it on Fridays with the 13:30 UTC cron. One row per
-- recipient: users active in the last 30 days who haven't turned weekly
-- emails off ('weekly_results') and whose address hasn't bounced or
-- complained. Numbers are for their account:
--   emails_sent      AI Submit / AI Invite emails sent from their Gmail
--   drafts           AI Submit / AI Invite drafts written
--   ai_match_runs    AI Match runs
--   new_subscribers  people who subscribed to their claimed profile
--   matches          new requirements matching their open consultants, or
--                    new consultants matching their open requirements (same
--                    embeddings and 0.70 threshold as the morning brief)
-- Rows where everything is zero are left out.

create or replace function public.get_weekly_results()
returns table (
  user_id uuid,
  account_id uuid,
  email text,
  first_name text,
  persona text,
  credits_balance numeric,
  emails_sent integer,
  drafts integer,
  ai_match_runs integer,
  new_subscribers integer,
  matches integer,
  match_kind text,
  consultant_count integer,
  requirement_count integer
)
language sql
stable
security definer
set search_path = public, extensions, auth
as $$
  with recipients as (
    select distinct on (u.id)
      u.id as user_id, am.account_id, u.email::text as email,
      nullif(initcap(split_part(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ' ', 1)), '') as first_name,
      a.active_persona::text as persona,
      coalesce(a.credits_balance, 0) as credits_balance
    from auth.users u
    join public.account_members am on am.user_id = u.id and am.status = 'active'
    join public.accounts a on a.id = am.account_id
    where u.email is not null
      and u.email_confirmed_at is not null
      and exists (
        select 1 from public.user_activity_daily d
        where d.user_id = u.id and d.activity_date >= current_date - 30
      )
      and not exists (
        select 1 from public.notification_preferences np
        where np.user_id = u.id and np.notif_type = 'weekly_results' and np.email_enabled = false
      )
      and not exists (
        select 1 from public.email_sends s
        where lower(s.to_email) = lower(u.email) and (s.complained_at is not null or s.bounce_type like 'Permanent%')
      )
    order by u.id, am.created_at asc
  ),
  accts as (select distinct account_id from recipients),
  sent as (
    select vc.account_id, count(*)::integer as n
    from public.vendor_messages vm
    join public.vendor_conversations vc on vc.id = vm.conversation_id
    join accts on accts.account_id = vc.account_id
    where vm.direction = 'outbound' and vm.created_at >= now() - interval '7 days'
    group by vc.account_id
  ),
  usage as (
    select ct.account_id,
      count(*) filter (where ct.description like 'Usage: pulse_ask_ai_preview_generate%')::integer as drafts,
      count(*) filter (where ct.description like 'Usage: ai_match_run%')::integer as runs
    from public.credit_transactions ct
    join accts on accts.account_id = ct.account_id
    where ct.type = 'usage' and ct.created_at >= now() - interval '7 days'
    group by ct.account_id
  ),
  subs as (
    select p.claimed_account_id as account_id, count(*)::integer as n
    from public.publisher_follows f
    join public.publisher_profiles p on p.id = f.publisher_id
    join accts on accts.account_id = p.claimed_account_id
    where f.created_at >= now() - interval '7 days'
    group by p.claimed_account_id
  ),
  consultants as (
    select h.created_by_account_id as account_id, h.id, h.hotlist_embedding as emb
    from public.social_hotlist h
    join accts on accts.account_id = h.created_by_account_id
    where h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
  ),
  own_jobs as (
    select j.created_by_account_id as account_id, j.id, j.job_embedding as emb
    from public.social_jobs j
    join accts on accts.account_id = j.created_by_account_id
    where j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
  ),
  week_jobs as (
    select j.id, j.job_embedding as emb, j.created_by_account_id
    from public.social_jobs j
    where j.hidden_at is null and j.job_embedding is not null
      and coalesce(j.posted_at, j.created_at) >= now() - interval '7 days'
      and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
  ),
  week_hotlists as (
    select h.id, h.hotlist_embedding as emb, h.created_by_account_id
    from public.social_hotlist h
    where h.hidden_at is null and h.hotlist_embedding is not null
      and coalesce(h.posted_at, h.created_at) >= now() - interval '7 days'
  ),
  job_matches as (
    select t.account_id, count(*)::integer as n
    from (
      select c.account_id, j.id
      from consultants c cross join week_jobs j
      where c.emb is not null and j.created_by_account_id is distinct from c.account_id
      group by c.account_id, j.id
      having max(1 - (c.emb <=> j.emb)) >= 0.70
    ) t
    group by t.account_id
  ),
  hotlist_matches as (
    select t.account_id, count(*)::integer as n
    from (
      select o.account_id, h.id
      from own_jobs o cross join week_hotlists h
      where o.emb is not null and h.created_by_account_id is distinct from o.account_id
      group by o.account_id, h.id
      having max(1 - (o.emb <=> h.emb)) >= 0.70
    ) t
    group by t.account_id
  ),
  rows as (
    select r.*,
      coalesce(s.n, 0) as emails_sent,
      coalesce(u.drafts, 0) as drafts,
      coalesce(u.runs, 0) as ai_match_runs,
      coalesce(sb.n, 0) as new_subscribers,
      greatest(coalesce(jm.n, 0), coalesce(hm.n, 0)) as matches,
      case when coalesce(jm.n, 0) >= coalesce(hm.n, 0) and jm.n is not null then 'job'
           when hm.n is not null then 'hotlist' end as match_kind,
      (select count(*)::integer from consultants c where c.account_id = r.account_id) as consultant_count,
      (select count(*)::integer from own_jobs o where o.account_id = r.account_id) as requirement_count
    from recipients r
    left join sent s on s.account_id = r.account_id
    left join usage u on u.account_id = r.account_id
    left join subs sb on sb.account_id = r.account_id
    left join job_matches jm on jm.account_id = r.account_id
    left join hotlist_matches hm on hm.account_id = r.account_id
  )
  select user_id, account_id, email, first_name, persona, credits_balance,
    emails_sent, drafts, ai_match_runs, new_subscribers, matches, match_kind, consultant_count, requirement_count
  from rows
  where emails_sent + drafts + ai_match_runs + new_subscribers + matches > 0;
$$;

revoke all on function public.get_weekly_results() from public, anon, authenticated;
grant execute on function public.get_weekly_results() to service_role;
