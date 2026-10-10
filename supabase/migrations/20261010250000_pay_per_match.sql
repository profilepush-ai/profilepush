/*
# Pay per match

One thing costs credits: a match. 1 credit = 1 match = ₹0.25. Everything else
is free: opening posts, AI Submit and bulk sends from Gmail, Inbox drafts,
video screenings, Apply.

1. accounts.match_min_score (50-80, default 70): the account's minimum match.
   Match % is a fit score: 70 is where matching cut off before (similarity
   0.70, or 0.62 for Non-IT), and each point is 0.005 of similarity, so 50-80
   spans 0.60-0.75 (0.52-0.67 for Non-IT). The default keeps today's volume.
2. A new Tracker/Today match costs 1 credit (charge_tracker_match). Free when
   the pair was already paid (match_charges, shared with AI Match), when the
   job was already sent to, and for internal accounts. At most 30 a day per
   consultant or requirement.
3. Out of credits: the match waits in pipeline_waiting_matches instead. Any
   credit added (top-up, grant, refund) moves waiting matches in, best first,
   as far as the balance goes.
4. "Not a match" on a paid match refunds the credit, up to 20% of the
   account's paid matches in the last 30 days.
5. Free again: opening a job post (open_post_content) and video screenings.
*/

alter table public.accounts add column if not exists match_min_score smallint not null default 70
  check (match_min_score between 50 and 80);

alter table public.pipeline_cards add column if not exists fit_score smallint;
alter table public.pipeline_cards add column if not exists charged boolean not null default false;
alter table public.pipeline_cards add column if not exists refunded boolean not null default false;

-- Similarity a pair needs for a given minimum match %.
create or replace function public.pp_match_min_sim(p_pref integer, p_non_it boolean)
returns real language sql immutable as $$
  select ((case when p_non_it then 0.62 else 0.70 end) + (coalesce(p_pref, 70) - 70) / 200.0)::real;
$$;

-- Match % shown on cards: 70 at the default cut-off, 0.5 points per 0.0025 above it.
create or replace function public.pp_match_fit(p_sim real, p_non_it boolean)
returns smallint language sql immutable as $$
  select least(99, greatest(1, round(70 + (coalesce(p_sim, 0) - (case when p_non_it then 0.62 else 0.70 end)) * 200)))::smallint;
$$;

update public.pipeline_cards c
set fit_score = public.pp_match_fit(c.similarity, coalesce(j.job_category = 'Non-IT', false))
from public.social_jobs j
where c.fit_score is null and c.lead_kind = 'job' and j.id = c.lead_id;
update public.pipeline_cards c
set fit_score = public.pp_match_fit(c.similarity, false)
where c.fit_score is null;

-- Matches already paid for. Tracker rows name the consultant/requirement;
-- AI Match rows don't (a fresh paste has no post id yet), so a job paid for
-- in AI Match lands free in any of the account's columns for 2 days.
create table if not exists public.match_charges (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  subject_id uuid,
  lead_id uuid not null,
  source text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists match_charges_subject_lead_idx on public.match_charges (subject_id, lead_id) where subject_id is not null;
create index if not exists match_charges_account_lead_idx on public.match_charges (account_id, lead_id, created_at desc);
alter table public.match_charges enable row level security;

-- Matches found while the account had no credits.
create table if not exists public.pipeline_waiting_matches (
  subject_id uuid not null,
  lead_id uuid not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  subject_kind text not null,
  lead_kind text not null,
  similarity real,
  created_at timestamptz not null default now(),
  primary key (subject_id, lead_id)
);
create index if not exists pipeline_waiting_matches_account_idx on public.pipeline_waiting_matches (account_id, similarity desc);
alter table public.pipeline_waiting_matches enable row level security;

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

  -- A broad profile cannot drain the balance in one day.
  if (select count(*) from public.pipeline_cards c where c.subject_id = new.subject_id and c.added_at >= date_trunc('day', now())) >= 30 then
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

-- Moves waiting matches in, best first, while the balance lasts. Each insert
-- goes through charge_tracker_match, which takes the credit.
create or replace function public.unlock_waiting_matches(p_account_id uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  w record;
  v_moved integer := 0;
  v_balance numeric;
begin
  delete from public.pipeline_waiting_matches where account_id = p_account_id and created_at < now() - interval '14 days';
  for w in
    select * from public.pipeline_waiting_matches where account_id = p_account_id order by similarity desc nulls last, created_at desc
  loop
    select credits_balance into v_balance from public.accounts where id = p_account_id;
    exit when coalesce(v_balance, 0) < 1;
    delete from public.pipeline_waiting_matches where subject_id = w.subject_id and lead_id = w.lead_id;
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
    values (w.account_id, w.subject_kind, w.subject_id, w.lead_kind, w.lead_id, w.similarity)
    on conflict (subject_id, lead_id) do nothing;
    v_moved := v_moved + 1;
  end loop;
  return v_moved;
end;
$$;
revoke all on function public.unlock_waiting_matches(uuid) from public, anon, authenticated;

create or replace function public.accounts_unlock_on_credit()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from public.pipeline_waiting_matches w where w.account_id = new.id) then
    perform public.unlock_waiting_matches(new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists accounts_unlock_waiting_matches on public.accounts;
create trigger accounts_unlock_waiting_matches
after update of credits_balance on public.accounts
for each row when (new.credits_balance > old.credits_balance)
execute function public.accounts_unlock_on_credit();

-- "Not a match" on a paid match gives the credit back, up to 20% of the
-- account's paid matches in the last 30 days.
create or replace function public.refund_not_a_match()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_paid integer;
  v_refunded integer;
begin
  if new.stage = 'closed' and old.stage is distinct from 'closed' and new.closed_reason = 'not_a_match'
     and new.charged and not new.refunded then
    select count(*) filter (where description = 'Usage: match'), count(*) filter (where description = 'Refund: not a match')
    into v_paid, v_refunded
    from public.credit_transactions
    where account_id = new.account_id and created_at > now() - interval '30 days';
    if v_refunded < floor(v_paid * 0.2) then
      new.refunded := true;
      insert into public.credit_transactions (account_id, user_id, type, amount, description)
      values (new.account_id, auth.uid(), 'refund', 1, 'Refund: not a match');
      update public.accounts set credits_balance = round(coalesce(credits_balance, 0) + 1, 4) where id = new.account_id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists pipeline_cards_refund_not_a_match on public.pipeline_cards;
create trigger pipeline_cards_refund_not_a_match
before update of stage on public.pipeline_cards
for each row execute function public.refund_not_a_match();

-- Waiting matches per consultant/requirement, for the Tracker and Today.
create or replace function public.get_waiting_match_counts()
returns table(subject_id uuid, waiting bigint) language sql stable security definer set search_path to 'public' as $$
  select w.subject_id, count(*)
  from public.pipeline_waiting_matches w
  where w.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active')
  group by w.subject_id;
$$;
revoke all on function public.get_waiting_match_counts() from public, anon;
grant execute on function public.get_waiting_match_counts() to authenticated;

create or replace function public.set_match_min_score(p_score integer)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.accounts set match_min_score = greatest(50, least(80, p_score))
  where id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active');
end;
$$;
revoke all on function public.set_match_min_score(integer) from public, anon;
grant execute on function public.set_match_min_score(integer) to authenticated;

-- Opening a job post is free again.
create or replace function public.open_post_content(p_kind text, p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_content text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'unauthorized'); end if;
  if p_kind = 'hotlist' then
    select h.raw_post_content into v_content from public.social_hotlist h where h.id = p_lead_id;
  else
    select coalesce(nullif(btrim(j.post_content), ''), j.job_description) into v_content from public.social_jobs j where j.id = p_lead_id;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
  end if;
  return jsonb_build_object('content', coalesce(v_content, ''), 'charged', false);
end;
$$;

-- Video screenings are free.
create or replace function public.charge_screening_completion_credit(p_account_id uuid, p_application_id uuid)
returns table(success boolean, new_balance numeric, message text)
language plpgsql security definer set search_path to 'public' as $$
begin
  return query select true, (select a.credits_balance from public.accounts a where a.id = p_account_id), 'free';
end;
$$;

CREATE OR REPLACE FUNCTION public.refresh_pipeline_cards(p_lead_window interval DEFAULT '36:00:00'::interval, p_new_subjects_since timestamp with time zone DEFAULT (now() - '01:00:00'::interval), p_backfill_window interval DEFAULT '7 days'::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_count integer := 0;
  v_added integer;
begin
  -- Consultants -> requirements.
  with subjects as (
    select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb,
      h.visa_type, h.locations, h.candidate_summary, (h.job_category = 'Non-IT') as non_it,
      coalesce((select a.match_min_score from public.accounts a where a.id = h.created_by_account_id), 70) as pref,
      case when h.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_hotlist h
    where h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
      and h.created_by_account_id is not null and h.hotlist_embedding is not null
  ),
  leads as (
    select j.id, j.job_embedding as emb, coalesce(j.posted_at, j.created_at) as at, j.created_by_account_id,
      j.extracted_visa_types, j.post_content, j.location, (j.job_category = 'Non-IT') as non_it
    from public.social_jobs j
    where j.hidden_at is null and j.job_embedding is not null
      and coalesce(j.post_status, 'open') = 'open'
      and coalesce(j.posted_at, j.created_at) >= now() - p_backfill_window
      and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
      and (public.pp_job_lead_ok(j.country, j.job_category, j.job_title, j.location) or (j.job_category = 'Non-IT' and coalesce(j.country, 'US') = 'US' and not public.pp_is_recruiter_role(j.job_title)))
      and not public.pp_is_internal_account(j.created_by_account_id)
  ),
  pairs as (
    select s.account_id, s.id as subject_id, l.id as lead_id, (1 - (s.emb <=> l.emb))::real as sim,
      l.extracted_visa_types, l.post_content, l.location, s.visa_type, s.locations, s.candidate_summary,
      coalesce(s.non_it, false) as non_it, s.pref
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
      and coalesce(s.non_it, false) = coalesce(l.non_it, false)
  ),
  ranked as (
    select p.account_id, p.subject_id, p.lead_id, p.sim,
      row_number() over (partition by p.subject_id order by p.sim desc) as rn
    from pairs p
    where p.sim >= public.pp_match_min_sim(p.pref, p.non_it)
      and not exists (select 1 from public.pipeline_cards c where c.subject_id = p.subject_id and c.lead_id = p.lead_id)
      and public.pp_pair_ok(p.extracted_visa_types, p.post_content, p.location, p.visa_type, p.locations, p.candidate_summary)
  )
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
  select account_id, 'hotlist', subject_id, 'job', lead_id, sim from ranked where rn <= 15
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  -- Requirements -> consultants.
  with subjects as (
    select j.id, j.created_by_account_id as account_id, j.job_embedding as emb,
      j.extracted_visa_types, j.post_content, j.location,
      coalesce((select a.match_min_score from public.accounts a where a.id = j.created_by_account_id), 70) as pref,
      case when j.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_jobs j
    where j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
      and j.created_by_account_id is not null and j.job_embedding is not null
  ),
  leads as (
    select h.id, h.hotlist_embedding as emb, coalesce(h.posted_at, h.created_at) as at, h.created_by_account_id,
      h.visa_type, h.locations, h.candidate_summary
    from public.social_hotlist h
    where h.hidden_at is null and h.hotlist_embedding is not null
      and (h.post_source <> 'linkedin_scrape' or coalesce(btrim(h.bench_sales_recruiter_email), '') <> '')
      and coalesce(h.post_status, 'open') = 'open'
      and coalesce(h.posted_at, h.created_at) >= now() - p_backfill_window
      and public.pp_hotlist_lead_ok(h.country, h.job_category, h.role_title, h.locations)
      and not public.pp_is_internal_account(h.created_by_account_id)
  ),
  pairs as (
    select s.account_id, s.id as subject_id, l.id as lead_id, (1 - (s.emb <=> l.emb))::real as sim,
      s.extracted_visa_types, s.post_content, s.location, l.visa_type, l.locations, l.candidate_summary, s.pref
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
  ),
  ranked as (
    select p.account_id, p.subject_id, p.lead_id, p.sim,
      row_number() over (partition by p.subject_id order by p.sim desc) as rn
    from pairs p
    where p.sim >= public.pp_match_min_sim(p.pref, false)
      and not exists (select 1 from public.pipeline_cards c where c.subject_id = p.subject_id and c.lead_id = p.lead_id)
      and public.pp_pair_ok(p.extracted_visa_types, p.post_content, p.location, p.visa_type, p.locations, p.candidate_summary)
  )
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
  select account_id, 'job', subject_id, 'hotlist', lead_id, sim from ranked where rn <= 15
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rematch_pipeline_subject(p_subject_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_added integer := 0;
  v_accounts uuid[];
  v_since timestamptz;
begin
  -- Only posts this column hasn't been checked against: those that came in
  -- since its last rematch (30-minute overlap for posts still being embedded),
  -- or the last 36 hours the first time.
  select coalesce(max(m.checked_at), now() - interval '36 hours') - interval '30 minutes' into v_since
  from public.pipeline_match_cursor m where m.subject_id = p_subject_id;
  select array_agg(am.account_id) into v_accounts
  from public.account_members am where am.user_id = auth.uid() and am.status = 'active';

  if exists (select 1 from public.social_hotlist h where h.id = p_subject_id and h.created_by_account_id = any(v_accounts)) then
    with s as (
      select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb, h.visa_type, h.locations, h.candidate_summary,
        coalesce(h.job_category = 'Non-IT', false) as non_it,
        coalesce((select a.match_min_score from public.accounts a where a.id = h.created_by_account_id), 70) as pref
      from public.social_hotlist h where h.id = p_subject_id and h.hotlist_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, j.id as lead_id, (1 - (s.emb <=> j.job_embedding))::real as sim,
        j.extracted_visa_types, j.post_content, j.location, s.visa_type, s.locations, s.candidate_summary, s.non_it, s.pref
      from s join public.social_jobs j
        on j.hidden_at is null and j.job_embedding is not null and coalesce(j.post_status, 'open') = 'open'
       and j.created_at >= v_since
       and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
       and j.created_by_account_id is distinct from s.account_id
       and (public.pp_job_lead_ok(j.country, j.job_category, j.job_title, j.location) or (j.job_category = 'Non-IT' and coalesce(j.country, 'US') = 'US' and not public.pp_is_recruiter_role(j.job_title)))
       and not public.pp_is_internal_account(j.created_by_account_id)
       and coalesce(j.job_category = 'Non-IT', false) = s.non_it
      where not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = j.id)
      order by s.emb <=> j.job_embedding
      limit 15
    )
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
    select account_id, 'hotlist', subject_id, 'job', lead_id, sim from ranked
    where sim >= public.pp_match_min_sim(pref, non_it)
      and public.pp_pair_ok(extracted_visa_types, post_content, location, visa_type, locations, candidate_summary)
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_added = row_count;
  elsif exists (select 1 from public.social_jobs j where j.id = p_subject_id and j.created_by_account_id = any(v_accounts)) then
    with s as (
      select j.id, j.created_by_account_id as account_id, j.job_embedding as emb, j.extracted_visa_types, j.post_content, j.location,
        coalesce((select a.match_min_score from public.accounts a where a.id = j.created_by_account_id), 70) as pref
      from public.social_jobs j where j.id = p_subject_id and j.job_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, h.id as lead_id, (1 - (s.emb <=> h.hotlist_embedding))::real as sim,
        s.extracted_visa_types, s.post_content, s.location, h.visa_type, h.locations, h.candidate_summary, s.pref
      from s join public.social_hotlist h
        on h.hidden_at is null and h.hotlist_embedding is not null
       and (h.post_source <> 'linkedin_scrape' or coalesce(btrim(h.bench_sales_recruiter_email), '') <> '') and coalesce(h.post_status, 'open') = 'open'
       and h.created_at >= v_since
       and h.created_by_account_id is distinct from s.account_id
       and public.pp_hotlist_lead_ok(h.country, h.job_category, h.role_title, h.locations)
       and not public.pp_is_internal_account(h.created_by_account_id)
      where not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = h.id)
      order by s.emb <=> h.hotlist_embedding
      limit 15
    )
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
    select account_id, 'job', subject_id, 'hotlist', lead_id, sim from ranked
    where sim >= public.pp_match_min_sim(pref, false)
      and public.pp_pair_ok(extracted_visa_types, post_content, location, visa_type, locations, candidate_summary)
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_added = row_count;
  else
    raise exception 'not your post';
  end if;
  insert into public.pipeline_match_cursor (subject_id, checked_at) values (p_subject_id, now())
  on conflict (subject_id) do update set checked_at = now();
  return v_added;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_submission_queue(p_per_subject integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account uuid;
  v_is_trial boolean;
  v_target integer;
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_result jsonb;
begin
  select am.account_id into v_account from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1;
  if v_account is null then return null; end if;
  select coalesce(a.is_trial, true), a.daily_submission_target into v_is_trial, v_target from public.accounts a where a.id = v_account;

  with subjects as (
    select h.id, h.role_title, h.candidate_name, h.visa_type, h.locations, h.years_experience, h.core_skills,
      h.hourly_rate_min, h.hourly_rate_max, coalesce(h.posted_at, h.created_at) as at,
      r.url as resume_url, r.file_name as resume_file_name
    from public.social_hotlist h
    left join public.hotlist_resumes r on r.hotlist_id = h.id
    where h.created_by_account_id = v_account and h.post_source = 'user_post'
      and coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null
  ),
  items as (
    select c.subject_id, c.id as card_id, j.id as job_id, j.job_title, j.posted_by_name, j.company_name, j.location,
      j.salary_range, j.extracted_hourly_rate_min, j.extracted_hourly_rate_max, j.post_source, j.post_url,
      coalesce(j.posted_at, j.created_at) as posted_at, c.similarity, c.fit_score,
      coalesce(btrim(j.poster_email), '') <> '' as has_email,
      -- Last 3 days first, then by match; C2C requirements older than
      -- 14 days are usually filled, so they are left out.
      row_number() over (partition by c.subject_id
        order by (coalesce(j.posted_at, j.created_at) > now() - interval '3 days') desc, c.similarity desc, coalesce(j.posted_at, j.created_at) desc) as rn
    from public.pipeline_cards c
    join subjects s on s.id = c.subject_id
    join public.social_jobs j on j.id = c.lead_id
    where c.account_id = v_account and c.subject_kind = 'hotlist' and c.stage = 'new'
      and j.hidden_at is null and coalesce(j.post_status, 'open') = 'open'
      and coalesce(j.posted_at, j.created_at) > now() - interval '14 days'
  )
  select jsonb_build_object(
    'target', v_target,
    'daily_cap', case when v_is_trial then 10 else 100 end,
    'used_today', (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.created_at >= v_day),
    'submitted_today',
      (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.created_at >= v_day
         and r.job_id is not null and r.status in ('completed', 'fulfilled'))
      + (select count(*) from public.external_applications a where a.account_id = v_account and a.created_at >= v_day),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_id', s.id, 'role_title', s.role_title, 'candidate_name', s.candidate_name, 'visa_type', s.visa_type,
        'location', s.locations[1], 'years_experience', s.years_experience, 'skills', to_jsonb(s.core_skills[1:6]),
        'resume_url', s.resume_url, 'resume_file_name', s.resume_file_name,
        'submitted_today',
          (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.subject_hotlist_id = s.id
             and r.created_at >= v_day and r.status in ('completed', 'fulfilled'))
          + (select count(*) from public.external_applications a where a.account_id = v_account and a.subject_id = s.id and a.created_at >= v_day),
        'waiting', (select count(*) from items i where i.subject_id = s.id),
        'locked', (select count(*) from public.pipeline_waiting_matches w where w.subject_id = s.id),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'card_id', i.card_id, 'job_id', i.job_id, 'title', i.job_title, 'poster', i.posted_by_name, 'company', i.company_name,
            'location', i.location, 'pay', nullif(i.salary_range, ''), 'rate_min', i.extracted_hourly_rate_min, 'rate_max', i.extracted_hourly_rate_max,
            'source', i.post_source, 'apply_url', case when i.post_source = 'career_site' then i.post_url end,
            'posted_at', i.posted_at, 'similarity', round(i.similarity::numeric, 3), 'fit', coalesce(i.fit_score, round(i.similarity * 100)::int), 'has_email', i.has_email,
            'duplicate', public.submission_duplicate(v_account, s.id, i.job_id)
          ) order by i.rn)
          from items i where i.subject_id = s.id and i.rn <= p_per_subject
        ), '[]'::jsonb)
      ) order by s.at desc)
      from subjects s
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;
