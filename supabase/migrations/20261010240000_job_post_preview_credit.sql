/*
# Opening a job's full post costs 1 credit, the first time

Credits now pay for two things: opening a job's full post and sending an AI
Submit. Matches (AI Match runs, Tracker, Today) and Apply are free.

1. post_content_unlocks: the jobs each account has opened. Written only by
   open_post_content(); the account pays once per job, so reopening is free.
   Seeded from the existing "viewed" history so nobody pays again for a post
   they have already opened.
2. open_post_content(kind, id): returns a post's full text, charging 1 credit
   the first time an account opens a job. Free for consultant (hotlist) posts
   and for the account's own posts. Out of credits returns
   { error: 'insufficient_credits', balance } and charges nothing.
*/

create table if not exists public.post_content_unlocks (
  account_id uuid not null references public.accounts(id) on delete cascade,
  job_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (account_id, job_id)
);
alter table public.post_content_unlocks enable row level security;
-- No policies: read and written only through open_post_content().

insert into public.post_content_unlocks (account_id, job_id)
select distinct a.account_id, j.id
from public.pulse_lead_actions a
join public.social_jobs j on j.id::text = a.lead_id
where a.action_type = 'post_content_viewed' and a.account_id is not null
on conflict do nothing;

create or replace function public.open_post_content(p_kind text, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_account uuid;
  v_content text;
  v_owner uuid;
  v_balance numeric;
  v_charged boolean := false;
begin
  if auth.uid() is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  select am.account_id into v_account
  from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active'
  order by am.created_at
  limit 1;
  if v_account is null then
    return jsonb_build_object('error', 'no_account');
  end if;

  if p_kind = 'hotlist' then
    select h.raw_post_content into v_content from public.social_hotlist h where h.id = p_lead_id;
    return jsonb_build_object('content', coalesce(v_content, ''), 'charged', false);
  end if;

  select coalesce(nullif(btrim(j.post_content), ''), j.job_description), j.created_by_account_id
  into v_content, v_owner
  from public.social_jobs j
  where j.id = p_lead_id;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  if v_owner is distinct from v_account
     and not exists (select 1 from public.post_content_unlocks u where u.account_id = v_account and u.job_id = p_lead_id) then
    -- The row lock makes two quick opens of the same job charge once.
    select a.credits_balance into v_balance from public.accounts a where a.id = v_account for update;
    if coalesce(v_balance, 0) < 1 then
      return jsonb_build_object('error', 'insufficient_credits', 'balance', coalesce(v_balance, 0));
    end if;
    insert into public.post_content_unlocks (account_id, job_id) values (v_account, p_lead_id)
    on conflict do nothing;
    if found then
      update public.accounts set credits_balance = round(coalesce(credits_balance, 0) - 1, 4)
      where id = v_account
      returning credits_balance into v_balance;
      insert into public.credit_transactions (account_id, user_id, type, amount, description)
      values (v_account, auth.uid(), 'usage', -1, 'Usage: job_post_preview');
      v_charged := true;
    end if;
  end if;

  return jsonb_build_object('content', coalesce(v_content, ''), 'charged', v_charged, 'balance', v_balance);
end;
$$;
revoke all on function public.open_post_content(text, uuid) from public, anon;
grant execute on function public.open_post_content(text, uuid) to authenticated;
