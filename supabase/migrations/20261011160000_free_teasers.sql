/*
# Free accounts: teasers, a pause, then a second chance

Free accounts (never paid) spend their 100 free credits on 10 full matches a
day. When the credits run out:
1. For 7 days they still get 10 new matches a day, as teasers: the title and
   the match score only, free. Everything else stays on the server
   (pp_teaser_item), and Today asks for a top-up to see it.
2. Then new matches pause (they wait, as before, for a top-up).
3. Three days into the pause, grant_second_chances() adds 100 free credits
   once, with a notification; full matches start again. If those run out
   too, it's teasers for 7 days and a pause, with no third grant.
A top-up (any credit increase) reveals today's teasers first, 1 credit each,
and ends the teaser period.
*/

alter table public.pipeline_cards add column if not exists teaser boolean not null default false;
alter table public.accounts add column if not exists free_teaser_since timestamptz;
alter table public.accounts add column if not exists matches_paused_at timestamptz;
alter table public.accounts add column if not exists second_chance_at timestamptz;

-- A teaser card: the title and the match score, nothing else of the post.
create or replace function public.pp_teaser_item(c public.pipeline_cards)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'card_id', c.id, 'subject_id', c.subject_id, 'lead_id', c.lead_id, 'subject_kind', c.subject_kind,
    'fit', c.fit_score, 'similarity', round(c.similarity::numeric, 3), 'stage', c.stage, 'closed_reason', c.closed_reason,
    'viewed_at', c.viewed_at, 'saved_at', null, 'applied_at', null, 'added_at', c.added_at,
    'reply_in_inbox', false, 'how', 'email', 'teaser', true,
    'subject', (public.pp_card_item_json(c))->'subject',
    'lead', jsonb_build_object(
      'id', c.lead_id, 'kind', c.lead_kind,
      'title', coalesce(
        (select nullif(btrim(j.job_title), '') from public.social_jobs j where c.lead_kind = 'job' and j.id = c.lead_id),
        (select nullif(btrim(h.role_title), '') from public.social_hotlist h where c.lead_kind = 'hotlist' and h.id = c.lead_id),
        'Match'),
      'skills', '[]'::jsonb, 'visas', '[]'::jsonb, 'has_email', false, 'open', true, 'posted_at', c.added_at))
$$;
revoke all on function public.pp_teaser_item(public.pipeline_cards) from public, anon, authenticated;

create or replace function public.charge_tracker_match()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_non_it boolean := false;
  v_since timestamptz;
begin
  if exists (select 1 from public.pipeline_cards c where c.subject_id = new.subject_id and c.lead_id = new.lead_id) then
    return null;
  end if;
  if new.lead_kind = 'job' then
    select coalesce(j.job_category = 'Non-IT', false) into v_non_it from public.social_jobs j where j.id = new.lead_id;
  end if;
  -- The matchers send the full fit score; anything else gets the similarity-only one.
  new.fit_score := coalesce(new.fit_score, public.pp_match_fit(new.similarity, coalesce(v_non_it, false)));

  -- Already sent or applied to, internal accounts, or already paid: free.
  if new.stage is distinct from 'new' or public.pp_is_internal_account(new.account_id) then return new; end if;
  if exists (
    select 1 from public.match_charges m
    where m.account_id = new.account_id and m.lead_id = new.lead_id
      and (m.subject_id = new.subject_id or (m.subject_id is null and m.created_at > now() - interval '2 days'))
  ) then
    return new;
  end if;

  -- Daily caps. Free accounts: 10 new matches a day in all; the rest wait
  -- until a top-up. Paid accounts: per profile or job (30 unless changed).
  if not public.account_has_paid(new.account_id) then
    if (select count(*) from public.pipeline_cards c
        where c.account_id = new.account_id and (c.charged or c.teaser) and c.added_at >= date_trunc('day', now())) >= 10 then
      insert into public.pipeline_waiting_matches (subject_id, lead_id, account_id, subject_kind, lead_kind, similarity, fit_score)
      values (new.subject_id, new.lead_id, new.account_id, new.subject_kind, new.lead_kind, new.similarity, new.fit_score)
      on conflict do nothing;
      return null;
    end if;
  elsif (select count(*) from public.pipeline_cards c where c.subject_id = new.subject_id and c.added_at >= date_trunc('day', now()))
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
    delete from public.pipeline_waiting_matches where subject_id = new.subject_id and lead_id = new.lead_id;
    new.charged := true;
    return new;
  end if;

  -- A free account out of credits keeps getting its 10 a day for 7 days, as
  -- teasers (title and match score only, free); then its matches pause and
  -- wait for a top-up (or the second-chance credits, grant_second_chances).
  if not public.account_has_paid(new.account_id) then
    update public.accounts set free_teaser_since = coalesce(free_teaser_since, now()) where id = new.account_id
    returning free_teaser_since into v_since;
    if v_since > now() - interval '7 days' then
      new.teaser := true;
      return new;
    end if;
    update public.accounts set matches_paused_at = coalesce(matches_paused_at, now()) where id = new.account_id;
  end if;

  insert into public.pipeline_waiting_matches (subject_id, lead_id, account_id, subject_kind, lead_kind, similarity, fit_score)
  values (new.subject_id, new.lead_id, new.account_id, new.subject_kind, new.lead_kind, new.similarity, new.fit_score)
  on conflict do nothing;
  return null;
end;
$$;

-- Credits going up: today's teasers are revealed first (1 credit each), and
-- the teaser period and any pause end.
create or replace function public.pp_reveal_teasers()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  c record;
begin
  if coalesce(new.credits_balance, 0) <= coalesce(old.credits_balance, 0) then return null; end if;
  update public.accounts set free_teaser_since = null, matches_paused_at = null
  where id = new.id and (free_teaser_since is not null or matches_paused_at is not null);
  for c in
    select p.id, p.subject_id, p.lead_id from public.pipeline_cards p
    where p.account_id = new.id and p.teaser and p.stage = 'new' and p.added_at > now() - interval '24 hours'
    order by p.fit_score desc nulls last
  loop
    update public.accounts set credits_balance = round(credits_balance - 1, 4) where id = new.id and credits_balance >= 1;
    exit when not found;
    update public.pipeline_cards set teaser = false, charged = true, updated_at = now() where id = c.id;
    insert into public.credit_transactions (account_id, user_id, type, amount, description) values (new.id, null, 'usage', -1, 'Usage: match');
    insert into public.match_charges (account_id, subject_id, lead_id, source) values (new.id, c.subject_id, c.lead_id, 'tracker') on conflict do nothing;
  end loop;
  return null;
end;
$$;
-- Named to run before accounts_unlock_waiting_matches (triggers fire by name).
drop trigger if exists accounts_reveal_teasers on public.accounts;
create trigger accounts_reveal_teasers after update of credits_balance on public.accounts
  for each row execute function public.pp_reveal_teasers();

-- Three days into a pause: 100 free credits, once per account.
create or replace function public.grant_second_chances()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  a record;
  v_n integer := 0;
begin
  for a in
    select x.id from public.accounts x
    where x.matches_paused_at < now() - interval '3 days' and x.second_chance_at is null
      and not public.account_has_paid(x.id) and not public.pp_is_internal_account(x.id)
  loop
    update public.accounts set second_chance_at = now(), credits_balance = coalesce(credits_balance, 0) + 100 where id = a.id;
    insert into public.credit_transactions (account_id, user_id, type, amount, description)
    values (a.id, null, 'grant', 100, 'Second chance: 100 free credits');
    insert into public.notifications (account_id, user_id, type, title, body, link, read)
    select a.id, am.user_id, 'second_chance', 'We added 100 free credits: your matches are back',
      'Your daily matches start again today. Have a look in Today.', '/today', false
    from public.account_members am where am.account_id = a.id and am.status = 'active' and am.user_id is not null;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.grant_second_chances() from public, anon, authenticated;
select cron.unschedule('grant-second-chances') where exists (select 1 from cron.job where jobname = 'grant-second-chances');
select cron.schedule('grant-second-chances', '20 4 * * *', 'select public.grant_second_chances();');

create or replace function public.get_today(p_kind text default 'hotlist', p_tz text default 'UTC')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_kind text := case when p_kind = 'job' then 'job' else 'hotlist' end;
  v_day timestamptz := public.pp_day_start(p_tz);
  v_utc_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_is_trial boolean;
  v_target integer;
  v_subjects jsonb;
  v_items jsonb;
begin
  if v_account is null then return null; end if;
  select coalesce(a.is_trial, true), a.daily_submission_target into v_is_trial, v_target from public.accounts a where a.id = v_account;

  if v_kind = 'hotlist' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', h.id, 'title', h.role_title, 'name', h.candidate_name, 'visa', h.visa_type,
      'locations', to_jsonb(h.locations), 'years', h.years_experience, 'skills', to_jsonb(h.core_skills),
      'rate_min', h.hourly_rate_min, 'rate_max', h.hourly_rate_max, 'posted_at', coalesce(h.posted_at, h.created_at),
      'resumes', (
        select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'url', f.url, 'file_name', f.file_name, 'is_default', f.url = r.url)
          order by (f.url = r.url) desc nulls last, f.uploaded_at desc), '[]'::jsonb)
        from public.hotlist_resume_files f left join public.hotlist_resumes r on r.hotlist_id = f.hotlist_id
        where f.hotlist_id = h.id),
      'locked', (select count(*) from public.pipeline_waiting_matches w where w.subject_id = h.id),
      'applied_today', (select count(*) from public.pipeline_cards c where c.subject_id = h.id and c.applied_at >= v_day)
    ) order by coalesce(h.posted_at, h.created_at) desc), '[]'::jsonb)
    into v_subjects
    from public.social_hotlist h
    where h.created_by_account_id = v_account and h.post_source = 'user_post'
      and coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id, 'title', j.job_title, 'location', j.location, 'skills', coalesce(j.extracted_skills, '[]'::jsonb),
      'visas', coalesce(j.extracted_visa_types, '[]'::jsonb), 'rate_min', j.extracted_hourly_rate_min,
      'rate_max', j.extracted_hourly_rate_max, 'years', j.extracted_experience_years, 'posted_at', coalesce(j.posted_at, j.created_at),
      'locked', (select count(*) from public.pipeline_waiting_matches w where w.subject_id = j.id),
      'applied_today', (select count(*) from public.pipeline_cards c where c.subject_id = j.id and c.applied_at >= v_day)
    ) order by coalesce(j.posted_at, j.created_at) desc), '[]'::jsonb)
    into v_subjects
    from public.social_jobs j
    where j.created_by_account_id = v_account and j.post_source = 'user_post'
      and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null;
  end if;

  with picked as (
    select c.id, c.lead_id, c.fit_score, c.added_at
    from public.pipeline_cards c
    left join public.social_jobs j on c.lead_kind = 'job' and j.id = c.lead_id
    left join public.social_hotlist h on c.lead_kind = 'hotlist' and h.id = c.lead_id
    where c.account_id = v_account and c.subject_kind = v_kind and c.stage = 'new' and c.saved_at is null
      and c.added_at > now() - interval '24 hours'
      and (
        (c.lead_kind = 'job' and j.id is not null and j.hidden_at is null and coalesce(j.post_status, 'open') = 'open'
          and coalesce(j.posted_at, j.created_at) > now() - interval '14 days')
        or (c.lead_kind = 'hotlist' and h.id is not null and h.hidden_at is null and coalesce(h.post_status, 'open') = 'open')
      )
    order by c.fit_score desc nulls last, c.added_at desc
    limit 400
  )
  , eng as (
    select * from public.pp_lead_engagement(array(select k.lead_id from picked k))
  )
  -- Most viewed first (what everyone else is looking at), then the best fit.
  select coalesce(jsonb_agg(case when p.teaser then public.pp_teaser_item(p) else public.pp_card_item_json(p) || jsonb_build_object(
      'duplicate', case when v_kind = 'hotlist' then public.submission_duplicate(v_account, p.subject_id, p.lead_id) end,
      'eng', jsonb_build_object('views', coalesce(e.views, 0), 'applies', coalesce(e.applies, 0), 'saves', coalesce(e.saves, 0), 'shares', coalesce(e.shares, 0))) end
    order by coalesce(e.views, 0) desc, k.fit_score desc nulls last, k.added_at desc), '[]'::jsonb)
  into v_items
  from picked k join public.pipeline_cards p on p.id = k.id left join eng e on e.lead_id = k.lead_id;

  return jsonb_build_object(
    'kind', v_kind,
    'day_start', v_day,
    'target', v_target,
    'daily_cap', case when v_is_trial then 10 else 100 end,
    'used_today', (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.created_at >= v_utc_day),
    'applied_today', (select count(*) from public.pipeline_cards c where c.account_id = v_account and c.subject_kind = v_kind and c.applied_at >= v_day),
    'subjects', v_subjects,
    'items', v_items,
    'reel', public.pp_reel_stats(v_account, v_kind, p_tz),
    'avatar_on', public.pp_avatar_on(v_account),
    'teasers', (select jsonb_build_object('since', a.free_teaser_since, 'paused', a.matches_paused_at) from public.accounts a where a.id = v_account)
  );
end;
$$;

create or replace function public.get_history(p_kind text default 'hotlist', p_tab text default 'viewed', p_tz text default 'UTC')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_kind text := case when p_kind = 'job' then 'job' else 'hotlist' end;
  v_day timestamptz := public.pp_day_start(p_tz);
  v_items jsonb;
begin
  if v_account is null then return null; end if;
  select coalesce(jsonb_agg(case when p.teaser then public.pp_teaser_item(p) else public.pp_card_item_json(p) end || case when p_tab = 'shared' then jsonb_build_object('shared_at', k.sort_at) else '{}'::jsonb end
    order by k.sort_at desc), '[]'::jsonb)
  into v_items
  from (
    select c.id,
      case p_tab when 'saved' then c.saved_at when 'applied' then c.applied_at
        when 'shared' then (select max(a.created_at) from public.pulse_lead_actions a
          where a.account_id = c.account_id and a.lead_id = c.lead_id::text and a.action_type = 'shared')
        else c.viewed_at end as sort_at
    from public.pipeline_cards c
    where c.account_id = v_account and c.subject_kind = v_kind
      and case p_tab
        when 'saved' then c.saved_at is not null and c.stage = 'new'
        when 'applied' then c.applied_at is not null
        when 'shared' then exists (select 1 from public.pulse_lead_actions a
          where a.account_id = c.account_id and a.lead_id = c.lead_id::text and a.action_type = 'shared')
        else c.stage = 'new' and c.saved_at is null and c.viewed_at < v_day
      end
    order by sort_at desc nulls last
    limit 200
  ) k join public.pipeline_cards p on p.id = k.id;
  return jsonb_build_object(
    'tab', p_tab,
    'counts', (
      select jsonb_build_object(
        'viewed', count(*) filter (where c.stage = 'new' and c.saved_at is null and c.viewed_at < v_day),
        'saved', count(*) filter (where c.saved_at is not null and c.stage = 'new'),
        'applied', count(*) filter (where c.applied_at is not null),
        'shared', count(*) filter (where exists (select 1 from public.pulse_lead_actions a
          where a.account_id = c.account_id and a.lead_id = c.lead_id::text and a.action_type = 'shared')))
      from public.pipeline_cards c where c.account_id = v_account and c.subject_kind = v_kind),
    'items', v_items
  );
end;
$$;
revoke all on function public.get_history(text, text, text) from public, anon;
grant execute on function public.get_history(text, text, text) to authenticated;
