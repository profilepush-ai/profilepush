/*
# Admin: revenue and matches

admin_revenue_stats(days) for the admin dashboard's Revenue tab (called by the
admin-revenue function with the service role): revenue and payers, matches
charged/refunded/waiting, the signup -> matched -> ran out -> paid funnel, a
daily series, the top accounts by matches, and matcher health. Internal
accounts are left out.
*/

create or replace function public.admin_revenue_stats(p_days integer default 30)
returns jsonb language sql stable security definer set search_path to 'public', 'cron' as $$
  with win as (select now() - make_interval(days => greatest(1, least(365, p_days))) as since),
  accts as (select a.id, a.name, a.created_at, a.credits_balance from public.accounts a where not coalesce(a.is_internal, false)),
  paid_orders as (
    select o.account_id, o.amount_inr_paise, o.credits, coalesce(o.paid_at, o.created_at) as at
    from public.credit_topup_orders o join accts on accts.id = o.account_id where o.status = 'paid'
  ),
  tx as (
    select t.account_id, t.description, t.amount, t.created_at
    from public.credit_transactions t join accts on accts.id = t.account_id, win
    where t.created_at >= win.since
      and t.description in ('Usage: match', 'Usage: ai_match_run', 'Refund: not a match', 'Pulse refund: ai_match_run')
  ),
  days as (
    select generate_series(date_trunc('day', (select since from win)), date_trunc('day', now()), interval '1 day')::date as d
  )
  select jsonb_build_object(
    'days', greatest(1, least(365, p_days)),
    'revenue', jsonb_build_object(
      'window_inr', coalesce((select sum(amount_inr_paise) from paid_orders, win where at >= win.since), 0) / 100,
      'all_time_inr', coalesce((select sum(amount_inr_paise) from paid_orders), 0) / 100,
      'orders_window', (select count(*) from paid_orders, win where at >= win.since),
      'payers_all_time', (select count(distinct account_id) from paid_orders),
      'abandoned_window', (select count(*) from public.credit_topup_orders o join accts on accts.id = o.account_id, win where o.status <> 'paid' and o.created_at >= win.since)
    ),
    'matches', jsonb_build_object(
      'charged', (select count(*) from tx where description = 'Usage: match'),
      'ai_match_credits', coalesce((select -sum(amount) from tx where description = 'Usage: ai_match_run'), 0) - coalesce((select sum(amount) from tx where description = 'Pulse refund: ai_match_run'), 0),
      'refunded', (select count(*) from tx where description = 'Refund: not a match'),
      'accounts_charged', (select count(distinct account_id) from tx where description in ('Usage: match', 'Usage: ai_match_run')),
      'waiting', (select count(*) from public.pipeline_waiting_matches w join accts on accts.id = w.account_id),
      'waiting_accounts', (select count(distinct w.account_id) from public.pipeline_waiting_matches w join accts on accts.id = w.account_id)
    ),
    'funnel', jsonb_build_object(
      'signups', (select count(*) from accts, win where accts.created_at >= win.since),
      'got_matches', (select count(*) from accts, win where accts.created_at >= win.since
                        and exists (select 1 from public.pipeline_cards c where c.account_id = accts.id)),
      'ran_out', (select count(*) from accts, win where accts.created_at >= win.since and accts.credits_balance < 1),
      'paid', (select count(*) from accts, win where accts.created_at >= win.since
                 and exists (select 1 from paid_orders po where po.account_id = accts.id)),
      'zero_balance_all', (select count(*) from accts where credits_balance < 1)
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', days.d,
        'matches', (select count(*) from tx where tx.description = 'Usage: match' and tx.created_at::date = days.d),
        'revenue_inr', coalesce((select sum(amount_inr_paise) from paid_orders po where po.at::date = days.d), 0) / 100,
        'signups', (select count(*) from accts where accts.created_at::date = days.d)
      ) order by days.d)
      from days
    ), '[]'::jsonb),
    'top_accounts', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select accts.id, accts.name, floor(accts.credits_balance)::int as balance,
          count(*) filter (where tx.description = 'Usage: match') as matches,
          exists (select 1 from paid_orders po where po.account_id = accts.id) as paid,
          (select count(*) from public.pipeline_waiting_matches w where w.account_id = accts.id) as waiting
        from tx join accts on accts.id = tx.account_id
        where tx.description in ('Usage: match', 'Usage: ai_match_run')
        group by accts.id, accts.name, accts.credits_balance
        order by count(*) filter (where tx.description = 'Usage: match') desc
        limit 15
      ) t
    ), '[]'::jsonb),
    'matcher', jsonb_build_object(
      'last_run_at', (select max(d.start_time) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'pipeline-matcher'),
      'last_status', (select d.status from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'pipeline-matcher' order by d.start_time desc limit 1),
      'last_seconds', (select extract(epoch from d.end_time - d.start_time)::int from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'pipeline-matcher' and d.end_time is not null order by d.start_time desc limit 1),
      'failed_24h', (select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'pipeline-matcher' and d.status = 'failed' and d.start_time > now() - interval '24 hours'),
      'runs_24h', (select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'pipeline-matcher' and d.start_time > now() - interval '24 hours')
    )
  );
$$;
revoke all on function public.admin_revenue_stats(integer) from public, anon, authenticated;
