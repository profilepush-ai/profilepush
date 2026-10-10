/*
# Free accounts: 10 new matches a day, the rest wait

Free accounts (never paid) now get 10 new matches a day in all, across every
profile or job (it was 10 for each). Matches past that are kept as waiting
instead of dropped, so Today's reel can show how many more there are; a
top-up unlocks them (unlock_waiting_matches). With the 100 free matches at
signup that is about ten days of daily use. Paid accounts keep their caps per
profile or job (30 unless changed).

get_today adds what the reel shows: paid, credits, how many were watched
today, the daily streak, the waiting matches (count and a preview) and when
the next free matches arrive (the daily count resets at 00:00 UTC).
*/

create index if not exists pipeline_cards_account_added_idx on public.pipeline_cards (account_id, added_at desc);
create index if not exists pipeline_cards_account_viewed_idx on public.pipeline_cards (account_id, viewed_at desc) where viewed_at is not null;

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
        where c.account_id = new.account_id and c.charged and c.added_at >= date_trunc('day', now())) >= 10 then
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

  insert into public.pipeline_waiting_matches (subject_id, lead_id, account_id, subject_kind, lead_kind, similarity, fit_score)
  values (new.subject_id, new.lead_id, new.account_id, new.subject_kind, new.lead_kind, new.similarity, new.fit_score)
  on conflict do nothing;
  return null;
end;
$$;

-- Days in a row the account watched at least one match (in its time zone),
-- counting today once something was watched, else up to yesterday.
create or replace function public.pp_view_streak(p_account uuid, p_tz text)
returns integer language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
  v_day date;
  v_n integer := 0;
begin
  begin
    perform now() at time zone v_tz;
  exception when others then
    v_tz := 'UTC';
  end;
  v_day := (now() at time zone v_tz)::date;
  if not exists (select 1 from public.pipeline_cards c where c.account_id = p_account and c.viewed_at >= (v_day::timestamp at time zone v_tz)) then
    v_day := v_day - 1;
  end if;
  loop
    exit when not exists (
      select 1 from public.pipeline_cards c
      where c.account_id = p_account
        and c.viewed_at >= (v_day::timestamp at time zone v_tz)
        and c.viewed_at < ((v_day + 1)::timestamp at time zone v_tz));
    v_n := v_n + 1;
    v_day := v_day - 1;
    exit when v_n >= 365;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.pp_view_streak(uuid, text) from public, anon, authenticated;

-- The reel's numbers, added to Today.
create or replace function public.pp_reel_stats(p_account uuid, p_kind text, p_tz text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'paid', public.account_has_paid(p_account),
    'credits', (select a.credits_balance from public.accounts a where a.id = p_account),
    'watched_today', (select count(*) from public.pipeline_cards c
      where c.account_id = p_account and c.subject_kind = p_kind and c.viewed_at >= public.pp_day_start(p_tz)),
    'streak', public.pp_view_streak(p_account, p_tz),
    'free_daily', 10,
    'new_today', (select count(*) from public.pipeline_cards c
      where c.account_id = p_account and c.charged and c.added_at >= date_trunc('day', now())),
    'next_reset', date_trunc('day', now()) + interval '1 day',
    'waiting', (select count(*) from public.pipeline_waiting_matches w where w.account_id = p_account and w.subject_kind = p_kind),
    'waiting_preview', (
      select coalesce(jsonb_agg(x.v order by x.fit desc nulls last), '[]'::jsonb)
      from (
        select w.fit_score as fit, jsonb_build_object(
          'title', coalesce(nullif(btrim(j.job_title), ''), nullif(btrim(h.role_title), ''), 'Match'),
          'company', coalesce(nullif(btrim(j.company_name), ''), nullif(btrim(j.posted_by_name), ''), nullif(btrim(h.bench_sales_company_name), '')),
          'avatar', coalesce(nullif(btrim(j.avatar_url), ''), nullif(btrim(h.bench_sales_recruiter_avatar_url), '')),
          'fit', w.fit_score) as v
        from public.pipeline_waiting_matches w
        left join public.social_jobs j on w.lead_kind = 'job' and j.id = w.lead_id
        left join public.social_hotlist h on w.lead_kind = 'hotlist' and h.id = w.lead_id
        where w.account_id = p_account and w.subject_kind = p_kind
        order by w.fit_score desc nulls last
        limit 3
      ) x)
  )
$$;
revoke all on function public.pp_reel_stats(uuid, text, text) from public, anon, authenticated;

-- Today: the caller's profiles (or jobs, for vendors) and their new matches.
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
    select c.id, c.fit_score, c.added_at
    from public.pipeline_cards c
    left join public.social_jobs j on c.lead_kind = 'job' and j.id = c.lead_id
    left join public.social_hotlist h on c.lead_kind = 'hotlist' and h.id = c.lead_id
    where c.account_id = v_account and c.subject_kind = v_kind and c.stage = 'new' and c.saved_at is null
      and (c.viewed_at >= v_day or (c.viewed_at is null and c.added_at > now() - interval '3 days'))
      and (
        (c.lead_kind = 'job' and j.id is not null and j.hidden_at is null and coalesce(j.post_status, 'open') = 'open'
          and coalesce(j.posted_at, j.created_at) > now() - interval '14 days')
        or (c.lead_kind = 'hotlist' and h.id is not null and h.hidden_at is null and coalesce(h.post_status, 'open') = 'open')
      )
    order by c.fit_score desc nulls last, c.added_at desc
    limit 400
  )
  select coalesce(jsonb_agg(public.pp_card_item_json(p) || jsonb_build_object(
      'duplicate', case when v_kind = 'hotlist' then public.submission_duplicate(v_account, p.subject_id, p.lead_id) end)
    order by k.fit_score desc nulls last, k.added_at desc), '[]'::jsonb)
  into v_items
  from picked k join public.pipeline_cards p on p.id = k.id;

  return jsonb_build_object(
    'kind', v_kind,
    'day_start', v_day,
    'target', v_target,
    'daily_cap', case when v_is_trial then 10 else 100 end,
    'used_today', (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.created_at >= v_utc_day),
    'applied_today', (select count(*) from public.pipeline_cards c where c.account_id = v_account and c.subject_kind = v_kind and c.applied_at >= v_day),
    'subjects', v_subjects,
    'items', v_items,
    'reel', public.pp_reel_stats(v_account, v_kind, p_tz)
  );
end;
$$;
