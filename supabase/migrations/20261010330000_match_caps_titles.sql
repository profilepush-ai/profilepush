/*
# get_match_caps: name each open consultant/requirement

The Matching settings page lists every open consultant/requirement with its
daily limit, so the RPC returns kind and title too, open posts only.
*/

create or replace function public.get_match_caps()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with acct as (
    select am.account_id from public.account_members am
    where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1
  ),
  subj as (
    select h.id, 'hotlist'::text as kind, coalesce(nullif(btrim(h.role_title), ''), 'Consultant') as title, h.created_at
    from public.social_hotlist h, acct
    where h.created_by_account_id = acct.account_id and h.post_source = 'user_post'
      and coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null
    union all
    select j.id, 'job', coalesce(nullif(btrim(j.job_title), ''), 'Requirement'), j.created_at
    from public.social_jobs j, acct
    where j.created_by_account_id = acct.account_id and j.post_source = 'user_post'
      and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
  )
  select jsonb_build_object(
    'paid', public.account_has_paid(acct.account_id),
    'default_cap', case when public.account_has_paid(acct.account_id) then 30 else 10 end,
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_id', s.id, 'kind', s.kind, 'title', s.title,
        'cap', public.pp_daily_match_cap(acct.account_id, s.id),
        'today', (select count(*) from public.pipeline_cards c where c.subject_id = s.id and c.added_at >= date_trunc('day', now()))
      ) order by s.created_at desc)
      from subj s
    ), '[]'::jsonb)
  )
  from acct;
$$;
