/*
# Fit score and smarter matching

Match % was a rescaled similarity. It is now a fit score:
- 70 at the standard similarity cut-off (0.70; 0.62 Non-IT), 2 points per 0.01;
- location: same US state +4, remote job +3, different state without
  "relocate/anywhere" -4;
- visa: the consultant's visa is one the job lists +3;
- rate: consultant's minimum within the job's maximum +3, more than 15%
  above it -8;
- experience: meets the job's years +2, 3+ years short -6;
- posted in the last 24 hours +2.
Clamped to 1-99. Location/visa hard rules (pp_pair_ok) still apply.

The matchers now cut on fit >= the account's minimum, scoring pairs down to
10 points under it on similarity, so a strong practical fit just below the
similarity line qualifies. Consultants/requirements added in the last 3 days
keep the 7-day backfill window, so they keep getting backlog matches within
their daily limit. Waiting matches keep their fit score.
*/

create or replace function public.pp_fit_score(
  p_sim real, p_non_it boolean,
  p_job_visas jsonb, p_job_location text, p_job_rate_max numeric, p_job_exp numeric, p_job_posted timestamptz,
  p_person_visa text, p_person_locations text[], p_person_rate_min numeric, p_person_exp numeric, p_person_text text
) returns smallint language plpgsql stable cost 200 as $$
declare
  v numeric;
  jv text[];
  pv text[];
  js text[];
  ps text[];
begin
  v := 70 + (coalesce(p_sim, 0) - case when p_non_it then 0.62 else 0.70 end) * 200;

  if coalesce(p_job_location, '') ~* '\mremote\M' then
    v := v + 3;
  else
    js := public.pp_us_states(p_job_location);
    ps := public.pp_us_states(array_to_string(p_person_locations, ', '));
    if cardinality(js) > 0 and cardinality(ps) > 0 then
      if js && ps then v := v + 4;
      elsif coalesce(p_person_text, '') !~* 'relocat|anywhere' then v := v - 4;
      end if;
    end if;
  end if;

  jv := public.pp_visa_codes(coalesce(p_job_visas::text, ''));
  pv := public.pp_visa_codes(coalesce(p_person_visa, ''));
  if cardinality(jv) > 0 and cardinality(pv) > 0 and (pv && jv or ('opt' = any(pv) and 'ead' = any(jv))) then
    v := v + 3;
  end if;

  if coalesce(p_job_rate_max, 0) > 0 and p_person_rate_min is not null then
    if p_person_rate_min <= p_job_rate_max then v := v + 3;
    elsif p_person_rate_min > p_job_rate_max * 1.15 then v := v - 8;
    end if;
  end if;

  if coalesce(p_job_exp, 0) > 0 and p_person_exp is not null then
    if p_person_exp >= p_job_exp then v := v + 2;
    elsif p_person_exp < p_job_exp - 2 then v := v - 6;
    end if;
  end if;

  if p_job_posted is not null and p_job_posted > now() - interval '24 hours' then v := v + 2; end if;

  return least(99, greatest(1, round(v)))::smallint;
end;
$$;

-- Same score from values the matcher works out once per consultant and once
-- per candidate job (states, visa codes, remote, relocate), so scoring a pair
-- is only list comparisons.
create or replace function public.pp_fit_fast(
  p_sim real, p_non_it boolean,
  p_job_visas text[], p_job_states text[], p_job_remote boolean, p_job_rate_max numeric, p_job_exp numeric, p_job_posted timestamptz,
  p_person_visas text[], p_person_states text[], p_person_relocates boolean, p_person_rate_min numeric, p_person_exp numeric
) returns smallint language plpgsql stable as $$
declare
  v numeric := 70 + (coalesce(p_sim, 0) - case when p_non_it then 0.62 else 0.70 end) * 200;
begin
  if p_job_remote then
    v := v + 3;
  elsif cardinality(p_job_states) > 0 and cardinality(p_person_states) > 0 then
    if p_job_states && p_person_states then v := v + 4;
    elsif not coalesce(p_person_relocates, false) then v := v - 4;
    end if;
  end if;
  if cardinality(p_job_visas) > 0 and cardinality(p_person_visas) > 0
     and (p_person_visas && p_job_visas or ('opt' = any(p_person_visas) and 'ead' = any(p_job_visas))) then
    v := v + 3;
  end if;
  if coalesce(p_job_rate_max, 0) > 0 and p_person_rate_min is not null then
    if p_person_rate_min <= p_job_rate_max then v := v + 3;
    elsif p_person_rate_min > p_job_rate_max * 1.15 then v := v - 8;
    end if;
  end if;
  if coalesce(p_job_exp, 0) > 0 and p_person_exp is not null then
    if p_person_exp >= p_job_exp then v := v + 2;
    elsif p_person_exp < p_job_exp - 2 then v := v - 6;
    end if;
  end if;
  if p_job_posted is not null and p_job_posted > now() - interval '24 hours' then v := v + 2; end if;
  return least(99, greatest(1, round(v)))::smallint;
end;
$$;

alter table public.pipeline_waiting_matches add column if not exists fit_score smallint;

CREATE OR REPLACE FUNCTION public.charge_tracker_match()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  insert into public.pipeline_waiting_matches (subject_id, lead_id, account_id, subject_kind, lead_kind, similarity, fit_score)
  values (new.subject_id, new.lead_id, new.account_id, new.subject_kind, new.lead_kind, new.similarity, new.fit_score)
  on conflict do nothing;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.unlock_waiting_matches(p_account_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  w record;
  v_moved integer := 0;
  v_balance numeric;
begin
  delete from public.pipeline_waiting_matches where account_id = p_account_id and created_at < now() - interval '14 days';
  for w in
    select * from public.pipeline_waiting_matches where account_id = p_account_id order by fit_score desc nulls last, similarity desc nulls last, created_at desc
  loop
    select credits_balance into v_balance from public.accounts where id = p_account_id;
    exit when coalesce(v_balance, 0) < 1;
    delete from public.pipeline_waiting_matches where subject_id = w.subject_id and lead_id = w.lead_id;
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity, fit_score)
    values (w.account_id, w.subject_kind, w.subject_id, w.lead_kind, w.lead_id, w.similarity, w.fit_score)
    on conflict (subject_id, lead_id) do nothing;
    v_moved := v_moved + 1;
  end loop;
  return v_moved;
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

  -- AI Matches switched off on the Tracker: no new matches.
  if exists (select 1 from public.accounts a where a.id = any(v_accounts) and not a.auto_match_enabled) then
    return 0;
  end if;

  if exists (select 1 from public.social_hotlist h where h.id = p_subject_id and h.created_by_account_id = any(v_accounts)) then
    with s as (
      select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb, h.visa_type, h.locations, h.candidate_summary,
        h.hourly_rate_min, h.years_experience,
        coalesce(h.job_category = 'Non-IT', false) as non_it,
        coalesce((select a.match_min_score from public.accounts a where a.id = h.created_by_account_id), 70) as pref
      from public.social_hotlist h where h.id = p_subject_id and h.hotlist_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, j.id as lead_id, (1 - (s.emb <=> j.job_embedding))::real as sim,
        j.extracted_visa_types, j.post_content, j.location, s.visa_type, s.locations, s.candidate_summary, s.non_it, s.pref,
        j.extracted_hourly_rate_max, j.extracted_experience_years, coalesce(j.posted_at, j.created_at) as at,
        s.hourly_rate_min, s.years_experience
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
      limit 30
    ),
    scored as (
      select r.*, public.pp_fit_score(r.sim, r.non_it, r.extracted_visa_types, r.location, r.extracted_hourly_rate_max,
        r.extracted_experience_years, r.at, r.visa_type, r.locations, r.hourly_rate_min, r.years_experience, r.candidate_summary) as fit
      from ranked r
      where r.sim >= public.pp_match_min_sim(r.pref - 10, r.non_it)
    )
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity, fit_score)
    select account_id, 'hotlist', subject_id, 'job', lead_id, sim, fit from scored
    where fit >= pref
      and public.pp_pair_ok(extracted_visa_types, post_content, location, visa_type, locations, candidate_summary)
    order by fit desc, sim desc
    limit 15
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_added = row_count;
  elsif exists (select 1 from public.social_jobs j where j.id = p_subject_id and j.created_by_account_id = any(v_accounts)) then
    with s as (
      select j.id, j.created_by_account_id as account_id, j.job_embedding as emb, j.extracted_visa_types, j.post_content, j.location,
        j.extracted_hourly_rate_max, j.extracted_experience_years,
        coalesce((select a.match_min_score from public.accounts a where a.id = j.created_by_account_id), 70) as pref
      from public.social_jobs j where j.id = p_subject_id and j.job_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, h.id as lead_id, (1 - (s.emb <=> h.hotlist_embedding))::real as sim,
        s.extracted_visa_types, s.post_content, s.location, h.visa_type, h.locations, h.candidate_summary, s.pref,
        s.extracted_hourly_rate_max, s.extracted_experience_years, coalesce(h.posted_at, h.created_at) as at,
        h.hourly_rate_min, h.years_experience
      from s join public.social_hotlist h
        on h.hidden_at is null and h.hotlist_embedding is not null
       and (h.post_source <> 'linkedin_scrape' or coalesce(btrim(h.bench_sales_recruiter_email), '') <> '') and coalesce(h.post_status, 'open') = 'open'
       and h.created_at >= v_since
       and h.created_by_account_id is distinct from s.account_id
       and public.pp_hotlist_lead_ok(h.country, h.job_category, h.role_title, h.locations)
       and not public.pp_is_internal_account(h.created_by_account_id)
      where not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = h.id)
      order by s.emb <=> h.hotlist_embedding
      limit 30
    ),
    scored as (
      select r.*, public.pp_fit_score(r.sim, false, r.extracted_visa_types, r.location, r.extracted_hourly_rate_max,
        r.extracted_experience_years, r.at, r.visa_type, r.locations, r.hourly_rate_min, r.years_experience, r.candidate_summary) as fit
      from ranked r
      where r.sim >= public.pp_match_min_sim(r.pref - 10, false)
    )
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity, fit_score)
    select account_id, 'job', subject_id, 'hotlist', lead_id, sim, fit from scored
    where fit >= pref
      and public.pp_pair_ok(extracted_visa_types, post_content, location, visa_type, locations, candidate_summary)
    order by fit desc, sim desc
    limit 15
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
  -- Consultants -> requirements. Consultants added in the last 3 days keep
  -- the backfill window, so a new one keeps getting matches from the backlog
  -- day by day within its daily limit instead of only on its first run.
  with subjects as materialized (
    select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb,
      h.visa_type, h.locations, h.candidate_summary, h.hourly_rate_min, h.years_experience,
      public.pp_visa_codes(coalesce(h.visa_type, '')) as pv,
      public.pp_us_states(array_to_string(h.locations, ', ')) as ps,
      coalesce(h.candidate_summary, '') ~* 'relocat|anywhere' as relocates,
      (h.job_category = 'Non-IT') as non_it,
      coalesce(pa.match_min_score, 70) as pref,
      case when h.created_at >= least(p_new_subjects_since, now() - interval '3 days') then p_backfill_window else p_lead_window end as win
    from public.social_hotlist h
    left join public.accounts pa on pa.id = h.created_by_account_id
    where h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
      and h.created_by_account_id is not null and h.hotlist_embedding is not null
      and coalesce(pa.auto_match_enabled, true)
  ),
  leads as materialized (
    select j.id, j.job_embedding as emb, coalesce(j.posted_at, j.created_at) as at, j.created_by_account_id,
      j.extracted_visa_types, j.post_content, j.location, (j.job_category = 'Non-IT') as non_it,
      j.extracted_hourly_rate_max, j.extracted_experience_years
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
      l.extracted_visa_types, l.post_content, l.location, l.extracted_hourly_rate_max, l.extracted_experience_years, l.at,
      s.visa_type, s.locations, s.candidate_summary, s.hourly_rate_min, s.years_experience, s.pv, s.ps, s.relocates,
      coalesce(s.non_it, false) as non_it, s.pref
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
      and coalesce(s.non_it, false) = coalesce(l.non_it, false)
  ),
  -- Close enough on similarity to be worth scoring: up to 10 points under the
  -- account's minimum, which only strong location/visa/rate/experience
  -- signals can make up.
  -- Only pairs that are new to the column, and only the 60 closest per
  -- column, get the (costlier) fit score.
  candidates as materialized (
    select q.* from (
      select p.*, row_number() over (partition by p.subject_id order by p.sim desc) as near
      from pairs p
      where p.sim >= public.pp_match_min_sim(p.pref - 10, p.non_it)
        and not exists (select 1 from public.pipeline_cards c where c.subject_id = p.subject_id and c.lead_id = p.lead_id)
    ) q
    where q.near <= 20
  ),
  -- Each candidate job's states, visa codes and remote flag, once.
  cand_leads as materialized (
    select l.id, public.pp_visa_codes(coalesce(l.extracted_visa_types::text, '')) as jv,
      public.pp_us_states(l.location) as js, coalesce(l.location, '') ~* '\mremote\M' as remote
    from leads l
    where l.id in (select c.lead_id from candidates c)
  ),
  scored as materialized (
    select p.*, public.pp_fit_fast(p.sim, p.non_it, cl.jv, cl.js, cl.remote, p.extracted_hourly_rate_max,
      p.extracted_experience_years, p.at, p.pv, p.ps, p.relocates, p.hourly_rate_min, p.years_experience) as fit
    from candidates p
    join cand_leads cl on cl.id = p.lead_id
  ),
  ranked as (
    select p.account_id, p.subject_id, p.lead_id, p.sim, p.fit,
      row_number() over (partition by p.subject_id order by p.fit desc, p.sim desc) as rn
    from scored p
    where p.fit >= p.pref
      and public.pp_pair_ok(p.extracted_visa_types, p.post_content, p.location, p.visa_type, p.locations, p.candidate_summary)
  )
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity, fit_score)
  select account_id, 'hotlist', subject_id, 'job', lead_id, sim, fit from ranked where rn <= 15
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  -- Requirements -> consultants.
  with subjects as materialized (
    select j.id, j.created_by_account_id as account_id, j.job_embedding as emb,
      j.extracted_visa_types, j.post_content, j.location, j.extracted_hourly_rate_max, j.extracted_experience_years,
      public.pp_visa_codes(coalesce(j.extracted_visa_types::text, '')) as jv,
      public.pp_us_states(j.location) as js,
      coalesce(j.location, '') ~* '\mremote\M' as remote,
      coalesce(pa.match_min_score, 70) as pref,
      case when j.created_at >= least(p_new_subjects_since, now() - interval '3 days') then p_backfill_window else p_lead_window end as win
    from public.social_jobs j
    left join public.accounts pa on pa.id = j.created_by_account_id
    where j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
      and j.created_by_account_id is not null and j.job_embedding is not null
      and coalesce(pa.auto_match_enabled, true)
  ),
  leads as materialized (
    select h.id, h.hotlist_embedding as emb, coalesce(h.posted_at, h.created_at) as at, h.created_by_account_id,
      h.visa_type, h.locations, h.candidate_summary, h.hourly_rate_min, h.years_experience
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
      s.extracted_visa_types, s.post_content, s.location, s.extracted_hourly_rate_max, s.extracted_experience_years, l.at,
      l.visa_type, l.locations, l.candidate_summary, l.hourly_rate_min, l.years_experience, s.pref, s.jv, s.js, s.remote
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
  ),
  candidates as materialized (
    select q.* from (
      select p.*, row_number() over (partition by p.subject_id order by p.sim desc) as near
      from pairs p
      where p.sim >= public.pp_match_min_sim(p.pref - 10, false)
        and not exists (select 1 from public.pipeline_cards c where c.subject_id = p.subject_id and c.lead_id = p.lead_id)
    ) q
    where q.near <= 20
  ),
  -- Each candidate consultant's visa codes, states and relocation, once.
  cand_leads as materialized (
    select l.id, public.pp_visa_codes(coalesce(l.visa_type, '')) as pv,
      public.pp_us_states(array_to_string(l.locations, ', ')) as ps,
      coalesce(l.candidate_summary, '') ~* 'relocat|anywhere' as relocates
    from leads l
    where l.id in (select c.lead_id from candidates c)
  ),
  scored as materialized (
    select p.*, public.pp_fit_fast(p.sim, false, p.jv, p.js, p.remote, p.extracted_hourly_rate_max,
      p.extracted_experience_years, p.at, cl.pv, cl.ps, cl.relocates, p.hourly_rate_min, p.years_experience) as fit
    from candidates p
    join cand_leads cl on cl.id = p.lead_id
  ),
  ranked as (
    select p.account_id, p.subject_id, p.lead_id, p.sim, p.fit,
      row_number() over (partition by p.subject_id order by p.fit desc, p.sim desc) as rn
    from scored p
    where p.fit >= p.pref
      and public.pp_pair_ok(p.extracted_visa_types, p.post_content, p.location, p.visa_type, p.locations, p.candidate_summary)
  )
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity, fit_score)
  select account_id, 'job', subject_id, 'hotlist', lead_id, sim, fit from ranked where rn <= 15
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  return v_count;
end;
$function$;
