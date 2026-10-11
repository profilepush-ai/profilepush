/*
# Admin: Account Stats around what the app does now

admin_account_stats(start, end, include_internal) feeds the admin Account
Stats panes (called by the admin-stats function with the service role). It
replaces the edge function's batch reads of tables the app no longer uses
(searches, list downloads, previews, drafts, subscriptions, chats, Play Store
clicks) with one set-based read of what it does use:

- matches: pipeline_cards (added, watched = viewed_at, saved, not a match);
- applying: by email (pulse_ask_ai_requests with a job), on the site
  (external_applications), Ask Resume (vendors: pulse_ask_ai_requests with a
  hotlist), and questions to the poster (post_questions);
- results: a reply is a card moved to replied/interview/placed, or an inbound
  message on its conversation (or on a conversation no card points at);
  interviews and placed are card stages;
- money: paid top-ups (credit_topup_orders, INR and USD), credits spent (the
  ledger's usage net of refunds, without the 2026-09-20 balance reset);
- extras: AI Match runs, AI Apply fills, referrals, avatars, picture reports,
  emails we sent, sessions and active time.

Roles: 'jobs' (vendor), 'profiles' (bench_sales), 'job_seeker' (bench_sales
with job_seeker) and 'none' (no role chosen yet). Internal accounts are left
out unless p_include_internal.

Returns { accounts, daily, funnel, events, totals }:
- accounts: one row per account, activity counted inside the range;
- daily: { date, <role>: { metric: n } } per day, for the charts;
- funnel: per role and 'all', for accounts that signed up in the range.
  Activation stages count everyone who got at least that far, so a step that
  wasn't recorded (applied without a recorded watch) doesn't drop anyone and
  no stage is larger than the one above. The money steps nest by definition
  (second chance -> paused -> teasers -> ran out); paid counts every paying
  account, with paid_after_out for those that ran out first;
- events: the top 40 product_events in the range;
- totals: the summary cards, per role and 'all'.
*/

create or replace function public.admin_account_stats(
  p_start timestamptz default null,
  p_end timestamptz default null,
  p_include_internal boolean default false
)
returns jsonb language sql stable security definer set search_path = public as $$
with
bounds as (
  select coalesce(p_start, '-infinity'::timestamptz) as s, coalesce(p_end, now()) as e
),
acc as (
  select a.id, a.name as account_name, a.owner_id, a.created_at, a.credits_balance, a.billing_currency,
    coalesce(a.is_internal, false) as internal,
    a.free_teaser_since, a.matches_paused_at, a.second_chance_at,
    case when a.active_persona = 'vendor' then 'jobs'
         when a.active_persona = 'bench_sales' and a.job_seeker then 'job_seeker'
         when a.active_persona = 'bench_sales' then 'profiles'
         else 'none' end as role
  from public.accounts a
  where p_include_internal or not coalesce(a.is_internal, false)
),
mem as (
  select distinct on (am.account_id) am.account_id, am.user_id, am.display_name
  from public.account_members am join acc on acc.id = am.account_id
  where am.status = 'active'
  order by am.account_id, (am.role = 'owner') desc, am.created_at
),
who as (
  select acc.id,
    u.email,
    coalesce(nullif(btrim(mem.display_name), ''), nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(u.raw_user_meta_data->>'name'), ''), acc.account_name) as name
  from acc
  left join mem on mem.account_id = acc.id
  left join auth.users u on u.id = coalesce(acc.owner_id, mem.user_id)
),
cards as (
  select c.* from public.pipeline_cards c join acc on acc.id = c.account_id
),
first_in as (
  select m.conversation_id, min(coalesce(m.received_at, m.created_at)) as at
  from public.vendor_messages m where m.direction = 'inbound' group by 1
),
reply_units as (
  select c.account_id, coalesce(fi.at, c.stage_changed_at, c.updated_at) as at
  from cards c left join first_in fi on fi.conversation_id = c.conversation_id
  where c.stage in ('replied', 'interview', 'placed') or fi.conversation_id is not null
  union all
  select vc.account_id, fi.at
  from public.vendor_conversations vc
  join acc on acc.id = vc.account_id
  join first_in fi on fi.conversation_id = vc.id
  where not exists (select 1 from public.pipeline_cards c where c.conversation_id = vc.id)
),
paid_orders as (
  select o.account_id, coalesce(o.paid_at, o.created_at) as at, o.currency,
    coalesce(o.amount_minor, o.amount_inr_paise, 0) as minor,
    coalesce(o.credits, 0) + coalesce(o.bonus_credits, 0) as credits
  from public.credit_topup_orders o join acc on acc.id = o.account_id
  where o.status = 'paid'
),
-- Every countable event, all time: (when, account, metric, amount).
ev_raw as (
  select acc.created_at as at, acc.id as account_id, 'signups'::text as m, 1::numeric as n from acc
  union all select c.added_at, c.account_id, 'matches', 1 from cards c
  union all select c.added_at, c.account_id, 'matches_watched', 1 from cards c where c.viewed_at is not null
  union all select c.viewed_at, c.account_id, 'watched', 1 from cards c where c.viewed_at is not null
  union all select c.saved_at, c.account_id, 'saved', 1 from cards c where c.saved_at is not null
  union all select coalesce(c.stage_changed_at, c.updated_at), c.account_id, 'not_a_match', 1 from cards c where c.closed_reason = 'not_a_match'
  union all select coalesce(c.stage_changed_at, c.updated_at), c.account_id, 'interviews', 1 from cards c where c.stage in ('interview', 'placed')
  union all select coalesce(c.stage_changed_at, c.updated_at), c.account_id, 'placed', 1 from cards c where c.stage = 'placed'
  union all select r.at, r.account_id, 'replies', 1 from reply_units r
  union all
  select a.created_at, a.account_id, 'shared', 1
  from public.pulse_lead_actions a join acc on acc.id = a.account_id where a.action_type = 'shared'
  union all
  select r.created_at, r.account_id, case when r.job_id is not null then 'applied_email' else 'ask_resume' end, 1
  from public.pulse_ask_ai_requests r join acc on acc.id = r.account_id
  where coalesce(r.job_id, r.hotlist_id) is not null and coalesce(r.status, '') not in ('failed', 'refunded')
  union all
  select x.created_at, x.account_id, 'applied_site', 1
  from public.external_applications x join acc on acc.id = x.account_id
  union all
  select q.created_at, q.account_id, 'asks', 1
  from public.post_questions q join acc on acc.id = q.account_id
  union all
  select t.created_at, t.account_id, 'ai_match_runs', 1
  from public.credit_transactions t join acc on acc.id = t.account_id
  where t.type = 'usage' and t.description like '%ai_match_run%'
  union all
  select t.created_at, t.account_id, 'credits_spent', -t.amount
  from public.credit_transactions t join acc on acc.id = t.account_id
  where (t.type = 'usage' and coalesce(t.description, '') not like 'Balance reset%') or t.type = 'refund'
  union all
  select l.created_at, l.account_id, 'ai_apply_fills', 1
  from public.ai_apply_log l join acc on acc.id = l.account_id
  union all
  select r.created_at, r.referrer_account_id, 'referrals', 1
  from public.referrals r join acc on acc.id = r.referrer_account_id
  union all select p.at, p.account_id, 'paid_orders', 1 from paid_orders p
  union all select p.at, p.account_id, 'revenue_inr', p.minor / 100.0 from paid_orders p where p.currency = 'INR'
  union all select p.at, p.account_id, 'revenue_usd', p.minor / 100.0 from paid_orders p where p.currency = 'USD'
  union all select p.at, p.account_id, 'credits_bought', p.credits from paid_orders p
  union all
  select v.created_at, m.account_id, 'picture_reports', 1
  from public.visual_reports v join public.account_members m on m.user_id = v.user_id and m.status = 'active'
  join acc on acc.id = m.account_id
  union all
  select e.created_at, w.id, 'emails_received', 1
  from public.email_sends e join who w on w.email is not null and lower(e.to_email) = lower(w.email)
  where e.status = 'sent'
),
activity as (
  select d.account_id, d.activity_date, sum(d.session_count) as sessions, sum(d.active_seconds) as secs,
    max(d.last_activity_at) as last_at
  from public.user_activity_daily d join acc on acc.id = d.account_id
  group by 1, 2
),
-- The same events inside the range, by UTC day. Activity is already a day.
ev as (
  select (x.at at time zone 'UTC')::date as day, x.account_id, x.m, x.n
  from ev_raw x, bounds b where x.at >= b.s and x.at <= b.e
  union all
  select a.activity_date, a.account_id, k.m, k.n
  from activity a, bounds b,
    lateral (values ('active_days', 1::numeric), ('sessions', a.sessions::numeric), ('active_seconds', a.secs::numeric)) as k(m, n)
  where a.activity_date >= (b.s at time zone 'UTC')::date and a.activity_date <= (b.e at time zone 'UTC')::date
),
per as (
  select ev.account_id,
    sum(n) filter (where m = 'matches') as matches,
    sum(n) filter (where m = 'matches_watched') as matches_watched,
    sum(n) filter (where m = 'watched') as watched,
    sum(n) filter (where m = 'saved') as saved,
    sum(n) filter (where m = 'shared') as shared,
    sum(n) filter (where m = 'not_a_match') as not_a_match,
    sum(n) filter (where m = 'applied_email') as applied_email,
    sum(n) filter (where m = 'applied_site') as applied_site,
    sum(n) filter (where m = 'ask_resume') as ask_resume,
    sum(n) filter (where m = 'asks') as asks,
    sum(n) filter (where m = 'replies') as replies,
    sum(n) filter (where m = 'interviews') as interviews,
    sum(n) filter (where m = 'placed') as placed,
    sum(n) filter (where m = 'ai_match_runs') as ai_match_runs,
    sum(n) filter (where m = 'ai_apply_fills') as ai_apply_fills,
    sum(n) filter (where m = 'referrals') as referrals_made,
    sum(n) filter (where m = 'paid_orders') as paid_orders,
    sum(n) filter (where m = 'revenue_inr') as revenue_inr,
    sum(n) filter (where m = 'revenue_usd') as revenue_usd,
    sum(n) filter (where m = 'credits_bought') as credits_bought,
    sum(n) filter (where m = 'credits_spent') as credits_spent,
    sum(n) filter (where m = 'picture_reports') as picture_reports,
    sum(n) filter (where m = 'emails_received') as emails_received,
    sum(n) filter (where m = 'active_days') as active_days,
    sum(n) filter (where m = 'sessions') as sessions,
    sum(n) filter (where m = 'active_seconds') as active_seconds
  from ev group by ev.account_id
),
card_agg as (
  select c.account_id, count(*) as total, count(c.viewed_at) as viewed, count(c.applied_at) as applied,
    max(c.added_at) as last_match_at, bool_or(c.teaser) as any_teaser,
    bool_or(c.stage in ('interview', 'placed')) as interview, bool_or(c.stage = 'placed') as placed
  from cards c group by 1
),
subj as (
  select s.account_id, count(*) as total, count(*) filter (where s.active) as active
  from (
    select h.created_by_account_id as account_id, (coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null) as active
    from public.social_hotlist h where h.post_source = 'user_post' and h.created_by_account_id is not null
    union all
    select j.created_by_account_id, (coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null)
    from public.social_jobs j where j.post_source = 'user_post' and j.created_by_account_id is not null
  ) s group by 1
),
ever as (
  select x.account_id,
    bool_or(x.m in ('applied_email', 'applied_site', 'ask_resume')) as applied,
    bool_or(x.m = 'replies') as replied,
    bool_or(x.m = 'ai_match_runs') as ai_matched
  from ev_raw x group by 1
),
last_seen as (
  select a.account_id, max(a.last_at) as at from activity a group by 1
),
gmail_on as (
  select distinct g.account_id from public.gmail_integrations g where g.status = 'connected'
),
avatar_on as (
  select distinct m.account_id
  from public.account_members m join public.user_avatars ua on ua.user_id = m.user_id
  where m.status = 'active' and ua.status = 'active'
),
payers as (
  select distinct p.account_id from paid_orders p
),
referred as (
  select distinct r.referee_account_id as account_id from public.referrals r
),
row_data as (
  select acc.id, acc.role, acc.internal, acc.created_at,
    who.name, who.email,
    floor(extract(epoch from now() - acc.created_at) / 86400)::int as age_days,
    ls.at as last_active,
    coalesce(per.sessions, 0) as sessions, coalesce(per.active_seconds, 0) as active_seconds,
    coalesce(per.active_days, 0) as active_days,
    (gm.account_id is not null) as gmail_connected,
    (av.account_id is not null) as avatar_on,
    acc.billing_currency,
    (py.account_id is not null) as paid,
    round(coalesce(per.revenue_inr, 0), 2) as revenue_inr, round(coalesce(per.revenue_usd, 0), 2) as revenue_usd,
    coalesce(per.paid_orders, 0) as paid_orders,
    round(coalesce(acc.credits_balance, 0), 2) as credits_balance,
    coalesce(per.credits_bought, 0) as credits_bought, round(coalesce(per.credits_spent, 0), 2) as credits_spent,
    coalesce(subj.active, 0) as profiles_or_jobs,
    coalesce(per.matches, 0) as matches, coalesce(per.matches_watched, 0) as matches_watched,
    coalesce(per.watched, 0) as watched, coalesce(per.saved, 0) as saved,
    coalesce(per.shared, 0) as shared, coalesce(per.not_a_match, 0) as not_a_match,
    coalesce(per.applied_email, 0) as applied_email, coalesce(per.applied_site, 0) as applied_site,
    coalesce(per.ask_resume, 0) as ask_resume, coalesce(per.asks, 0) as asks,
    coalesce(per.replies, 0) as replies, coalesce(per.interviews, 0) as interviews, coalesce(per.placed, 0) as placed,
    coalesce(per.ai_match_runs, 0) as ai_match_runs, coalesce(per.ai_apply_fills, 0) as ai_apply_fills,
    coalesce(per.referrals_made, 0) as referrals_made,
    (rf.account_id is not null) as referred_by,
    coalesce(per.picture_reports, 0) as picture_reports, coalesce(per.emails_received, 0) as emails_received,
    case when acc.matches_paused_at is not null then 'paused'
         when acc.free_teaser_since is not null then 'teasers'
         when acc.second_chance_at is not null then 'second_chance'
         else 'none' end as teaser_state,
    ca.last_match_at,
    -- Funnel inputs (all time).
    (acc.created_at >= b.s and acc.created_at <= b.e) as in_cohort,
    greatest(
      0,
      case when acc.role <> 'none' then 1 else 0 end,
      case when coalesce(subj.total, 0) > 0 then 2 else 0 end,
      case when coalesce(ca.total, 0) > 0 or coalesce(ev2.ai_matched, false) then 3 else 0 end,
      case when coalesce(ca.viewed, 0) > 0 then 4 else 0 end,
      case when coalesce(ca.applied, 0) > 0 or coalesce(ev2.applied, false) then 5 else 0 end,
      case when coalesce(ev2.replied, false) then 6 else 0 end,
      case when coalesce(ca.interview, false) then 7 else 0 end,
      case when coalesce(ca.placed, false) then 8 else 0 end
    ) as furthest,
    (acc.second_chance_at is not null) as m_second_chance,
    (acc.matches_paused_at is not null or acc.second_chance_at is not null) as m_paused,
    (acc.free_teaser_since is not null or acc.matches_paused_at is not null or acc.second_chance_at is not null
      or coalesce(ca.any_teaser, false)) as m_teasers,
    (coalesce(acc.credits_balance, 0) < 1 or acc.free_teaser_since is not null or acc.matches_paused_at is not null
      or acc.second_chance_at is not null or coalesce(ca.any_teaser, false)) as m_ran_out
  from acc
  cross join bounds b
  join who on who.id = acc.id
  left join per on per.account_id = acc.id
  left join card_agg ca on ca.account_id = acc.id
  left join subj on subj.account_id = acc.id
  left join ever ev2 on ev2.account_id = acc.id
  left join last_seen ls on ls.account_id = acc.id
  left join gmail_on gm on gm.account_id = acc.id
  left join avatar_on av on av.account_id = acc.id
  left join payers py on py.account_id = acc.id
  left join referred rf on rf.account_id = acc.id
),
funnel_rows as (
  select case when grouping(r.role) = 1 then 'all' else r.role end as role,
    jsonb_build_object(
      'signed_up', count(*),
      'chose_role', count(*) filter (where r.furthest >= 1),
      'added_first', count(*) filter (where r.furthest >= 2),
      'got_match', count(*) filter (where r.furthest >= 3),
      'watched', count(*) filter (where r.furthest >= 4),
      'applied', count(*) filter (where r.furthest >= 5),
      'replied', count(*) filter (where r.furthest >= 6),
      'interview', count(*) filter (where r.furthest >= 7),
      'placed', count(*) filter (where r.furthest >= 8),
      'ran_out', count(*) filter (where r.m_ran_out),
      'saw_teasers', count(*) filter (where r.m_teasers),
      'paused', count(*) filter (where r.m_paused),
      'second_chance', count(*) filter (where r.m_second_chance),
      'paid', count(*) filter (where r.paid),
      'paid_after_out', count(*) filter (where r.paid and r.m_ran_out)
    ) as stages
  from row_data r where r.in_cohort
  group by grouping sets ((r.role), ())
),
totals_rows as (
  select case when grouping(r.role) = 1 then 'all' else r.role end as role,
    jsonb_build_object(
      'accounts', count(*),
      'signups', count(*) filter (where r.in_cohort),
      'active', count(*) filter (where r.active_days > 0),
      'sessions', sum(r.sessions),
      'active_seconds', sum(r.active_seconds),
      'gmail_connected', count(*) filter (where r.gmail_connected),
      'avatars_on', count(*) filter (where r.avatar_on),
      'with_profiles_or_jobs', count(*) filter (where r.profiles_or_jobs > 0),
      'profiles_or_jobs', sum(r.profiles_or_jobs),
      'matches', sum(r.matches),
      'matches_watched', sum(r.matches_watched),
      'watched', sum(r.watched),
      'saved', sum(r.saved),
      'shared', sum(r.shared),
      'not_a_match', sum(r.not_a_match),
      'applied_email', sum(r.applied_email),
      'applied_site', sum(r.applied_site),
      'ask_resume', sum(r.ask_resume),
      'asks', sum(r.asks),
      'replies', sum(r.replies),
      'interviews', sum(r.interviews),
      'placed', sum(r.placed)
    ) || jsonb_build_object(
      'paid_accounts', count(*) filter (where r.paid),
      'paid_orders', sum(r.paid_orders),
      'revenue_inr', sum(r.revenue_inr),
      'revenue_usd', sum(r.revenue_usd),
      'credits_bought', sum(r.credits_bought),
      'credits_spent', sum(r.credits_spent),
      'ai_match_runs', sum(r.ai_match_runs),
      'ai_apply_fills', sum(r.ai_apply_fills),
      'referrals', sum(r.referrals_made),
      'referred', count(*) filter (where r.referred_by),
      'picture_reports', sum(r.picture_reports),
      'emails_received', sum(r.emails_received),
      'teasers_now', count(*) filter (where r.teaser_state = 'teasers'),
      'paused_now', count(*) filter (where r.teaser_state = 'paused')
    ) as t
  from row_data r
  group by grouping sets ((r.role), ())
),
daily_rows as (
  select d.day, jsonb_object_agg(d.role, d.metrics) as roles
  from (
    select x.day, x.role, jsonb_object_agg(x.m, x.n) as metrics
    from (
      select ev.day, acc.role, case when ev.m = 'active_days' then 'active_users' else ev.m end as m, round(sum(ev.n), 2) as n
      from ev join acc on acc.id = ev.account_id
      where ev.m in ('signups', 'active_days', 'sessions', 'matches', 'watched', 'saved', 'shared', 'not_a_match',
        'applied_email', 'applied_site', 'ask_resume', 'asks', 'replies', 'interviews', 'placed', 'paid_orders',
        'revenue_inr', 'revenue_usd', 'credits_spent', 'ai_match_runs', 'ai_apply_fills', 'referrals')
      group by 1, 2, 3
    ) x
    group by x.day, x.role
  ) d
  group by d.day
),
event_rows as (
  select p.event, count(*) as n, count(distinct p.account_id) as accounts
  from public.product_events p, bounds b
  where p.created_at >= b.s and p.created_at <= b.e
    and (p.account_id is null or p.account_id in (select id from acc))
  group by p.event
  order by count(*) desc, p.event
  limit 40
)
select jsonb_build_object(
  'range', jsonb_build_object('start', p_start, 'end', coalesce(p_end, now()), 'include_internal', p_include_internal),
  'accounts', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'account_id', r.id, 'name', r.name, 'email', r.email, 'role', r.role, 'internal', r.internal,
        'created_at', r.created_at, 'age_days', r.age_days, 'last_active', r.last_active,
        'sessions', r.sessions, 'active_seconds', r.active_seconds, 'active_days', r.active_days,
        'gmail_connected', r.gmail_connected, 'avatar_on', r.avatar_on, 'billing_currency', r.billing_currency,
        'paid', r.paid, 'revenue_inr', r.revenue_inr, 'revenue_usd', r.revenue_usd,
        'credits_balance', r.credits_balance, 'credits_bought', r.credits_bought, 'credits_spent', r.credits_spent,
        'profiles_or_jobs', r.profiles_or_jobs
      ) || jsonb_build_object(
        'matches', r.matches, 'matches_watched', r.matches_watched, 'watched', r.watched, 'saved', r.saved,
        'shared', r.shared, 'not_a_match', r.not_a_match,
        'applied_email', r.applied_email, 'applied_site', r.applied_site, 'ask_resume', r.ask_resume, 'asks', r.asks,
        'replies', r.replies, 'interviews', r.interviews, 'placed', r.placed,
        'ai_match_runs', r.ai_match_runs, 'ai_apply_fills', r.ai_apply_fills,
        'referrals_made', r.referrals_made, 'referred_by', r.referred_by,
        'picture_reports', r.picture_reports, 'emails_received', r.emails_received,
        'teaser_state', r.teaser_state, 'last_match_at', r.last_match_at
      )
      order by r.created_at desc)
    from row_data r
  ), '[]'::jsonb),
  'daily', coalesce((select jsonb_agg(jsonb_build_object('date', d.day) || d.roles order by d.day) from daily_rows d), '[]'::jsonb),
  'funnel', coalesce((select jsonb_object_agg(f.role, f.stages) from funnel_rows f), '{}'::jsonb),
  'events', coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'count', e.n, 'accounts', e.accounts) order by e.n desc, e.event) from event_rows e), '[]'::jsonb),
  'totals', coalesce((select jsonb_object_agg(t.role, t.t) from totals_rows t), '{}'::jsonb)
);
$$;

revoke all on function public.admin_account_stats(timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.admin_account_stats(timestamptz, timestamptz, boolean) to service_role;
