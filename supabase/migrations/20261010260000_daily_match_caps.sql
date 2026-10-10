/*
# Daily match caps per consultant or requirement

New matches a consultant or requirement can get in a day (UTC):
- Free accounts: 10, fixed.
- Paid accounts (account_has_paid): 30 by default, or the number the account
  chose for that consultant/requirement (5-100), set from its Tracker column.
Internal accounts are not charged and not capped, as before. AI Match runs are
not capped (they are asked for).
*/

create table if not exists public.pipeline_subject_settings (
  subject_id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  daily_match_cap smallint not null check (daily_match_cap between 5 and 100),
  updated_at timestamptz not null default now()
);
alter table public.pipeline_subject_settings enable row level security;

create or replace function public.pp_daily_match_cap(p_account_id uuid, p_subject_id uuid)
returns integer language sql stable security definer set search_path to 'public' as $$
  select case
    when not public.account_has_paid(p_account_id) then 10
    else coalesce((select s.daily_match_cap from public.pipeline_subject_settings s where s.subject_id = p_subject_id), 30)
  end;
$$;

create or replace function public.charge_tracker_match()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_non_it boolean := false;
begin
  if exists (select 1 from public.pipeline_cards c where c.subject_id = new.subject_id and c.lead_id = new.lead_id) then
    return null;
  end if;
  if new.lead_kind = 'job' then
    select coalesce(j.job_category = 'Non-IT', false) into v_non_it from public.social_jobs j where j.id = new.lead_id;
  end if;
  new.fit_score := public.pp_match_fit(new.similarity, coalesce(v_non_it, false));

  -- Already sent or applied to, internal accounts, or already paid: free.
  if new.stage is distinct from 'new' or public.pp_is_internal_account(new.account_id) then return new; end if;
  if exists (
    select 1 from public.match_charges m
    where m.account_id = new.account_id and m.lead_id = new.lead_id
      and (m.subject_id = new.subject_id or (m.subject_id is null and m.created_at > now() - interval '2 days'))
  ) then
    return new;
  end if;

  -- Daily cap per consultant/requirement: 10 on free accounts; on paid ones
  -- 30 unless the account chose another number for this one.
  if (select count(*) from public.pipeline_cards c where c.subject_id = new.subject_id and c.added_at >= date_trunc('day', now()))
     >= public.pp_daily_match_cap(new.account_id, new.subject_id) then
    return null;
  end if;

  update public.accounts set credits_balance = round(credits_balance - 1, 4)
  where id = new.account_id and credits_balance >= 1;
  if found then
    insert into public.credit_transactions (account_id, user_id, type, amount, description)
    values (new.account_id, null, 'usage', -1, 'Usage: match');
    insert into public.match_charges (account_id, subject_id, lead_id, source)
    values (new.account_id, new.subject_id, new.lead_id, 'tracker') on conflict do nothing;
    new.charged := true;
    return new;
  end if;

  insert into public.pipeline_waiting_matches (subject_id, lead_id, account_id, subject_kind, lead_kind, similarity)
  values (new.subject_id, new.lead_id, new.account_id, new.subject_kind, new.lead_kind, new.similarity)
  on conflict do nothing;
  return null;
end;
$$;

-- The caller's consultants/requirements with today's count and cap.
create or replace function public.get_match_caps()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with acct as (
    select am.account_id from public.account_members am
    where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1
  ),
  subj as (
    select h.id from public.social_hotlist h, acct where h.created_by_account_id = acct.account_id and h.post_source = 'user_post'
    union all
    select j.id from public.social_jobs j, acct where j.created_by_account_id = acct.account_id and j.post_source = 'user_post'
  )
  select jsonb_build_object(
    'paid', public.account_has_paid(acct.account_id),
    'default_cap', case when public.account_has_paid(acct.account_id) then 30 else 10 end,
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_id', s.id,
        'cap', public.pp_daily_match_cap(acct.account_id, s.id),
        'today', (select count(*) from public.pipeline_cards c where c.subject_id = s.id and c.added_at >= date_trunc('day', now()))
      ))
      from subj s
    ), '[]'::jsonb)
  )
  from acct;
$$;
revoke all on function public.get_match_caps() from public, anon;
grant execute on function public.get_match_caps() to authenticated;

create or replace function public.set_subject_match_cap(p_subject_id uuid, p_cap integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_account uuid;
begin
  select am.account_id into v_account from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1;
  if v_account is null then return jsonb_build_object('error', 'no_account'); end if;
  if not exists (select 1 from public.social_hotlist h where h.id = p_subject_id and h.created_by_account_id = v_account)
     and not exists (select 1 from public.social_jobs j where j.id = p_subject_id and j.created_by_account_id = v_account) then
    return jsonb_build_object('error', 'not_your_post');
  end if;
  if not public.account_has_paid(v_account) then
    return jsonb_build_object('error', 'paid_only');
  end if;
  insert into public.pipeline_subject_settings (subject_id, account_id, daily_match_cap, updated_at)
  values (p_subject_id, v_account, greatest(5, least(100, p_cap)), now())
  on conflict (subject_id) do update set daily_match_cap = excluded.daily_match_cap, updated_at = now();
  return jsonb_build_object('cap', greatest(5, least(100, p_cap)));
end;
$$;
revoke all on function public.set_subject_match_cap(uuid, integer) from public, anon;
grant execute on function public.set_subject_match_cap(uuid, integer) to authenticated;
