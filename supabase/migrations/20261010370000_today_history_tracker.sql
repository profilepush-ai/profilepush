/*
# Today, History and Tracker: cards that move on their own

Matches live in pipeline_cards. This adds what the new Today, History and
Tracker pages need, so nobody has to mark anything:

1. viewed_at, saved_at and applied_at on pipeline_cards, and a 'placed' stage.
   viewed_at is the first time a card was opened (or shown in swipe mode),
   saved_at is "saved for later" (free, never expires), applied_at is when it
   left New. Seeded from the history we already have.
2. Today shows new, unsaved cards that are unopened, or opened today in the
   caller's time zone. Opened ones move to History > Viewed the next day.
3. expire_unopened_matches(): unopened, unsaved cards close after 3 days (was 7).
4. tracker_auto_past(): applications with no reply in 14 days close as
   'no_response'; ones whose job post closed close as 'job_closed'. Daily.
5. Applying from outside Today (AI Match) adds a Tracker card, so every
   application shows up. Free: cards past New are never charged.
6. RPCs: get_today, get_history, get_tracker, mark_cards_viewed,
   set_card_saved, set_card_status.
*/

alter table public.pipeline_cards
  add column if not exists viewed_at timestamptz,
  add column if not exists saved_at timestamptz,
  add column if not exists applied_at timestamptz;

alter table public.pipeline_cards drop constraint if exists pipeline_cards_stage_check;
alter table public.pipeline_cards add constraint pipeline_cards_stage_check
  check (stage in ('new', 'submitted', 'replied', 'interview', 'placed', 'closed'));

create index if not exists pipeline_cards_saved_idx on public.pipeline_cards (account_id, saved_at desc) where saved_at is not null;
create index if not exists pipeline_cards_applied_idx on public.pipeline_cards (account_id, applied_at desc) where applied_at is not null;

-- Seed: applications already made, and posts already opened.
update public.pipeline_cards
set applied_at = stage_changed_at
where stage <> 'new' and applied_at is null and coalesce(closed_reason, '') not in ('expired', 'not_a_match');

update public.pipeline_cards c
set viewed_at = v.at
from (
  select x.account_id, x.lead_id, min(x.at) as at
  from (
    select a.account_id, a.lead_id::uuid as lead_id, a.created_at as at
    from public.pulse_lead_actions a
    where a.action_type = 'post_content_viewed' and a.account_id is not null
      and a.lead_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    union all
    select u.account_id, u.job_id, u.created_at from public.post_content_unlocks u
  ) x
  group by 1, 2
) v
where c.account_id = v.account_id and c.lead_id = v.lead_id and c.viewed_at is null;

-- applied_at follows the stage: set the first time a card leaves New.
create or replace function public.pipeline_card_applied_at()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.stage in ('submitted', 'replied', 'interview', 'placed') and new.applied_at is null then
    new.applied_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists pipeline_card_applied_at on public.pipeline_cards;
create trigger pipeline_card_applied_at before insert or update of stage on public.pipeline_cards
  for each row execute function public.pipeline_card_applied_at();

-- Start of "today" in the caller's time zone (UTC when the zone is unknown).
create or replace function public.pp_day_start(p_tz text)
returns timestamptz language plpgsql stable as $$
begin
  return date_trunc('day', now() at time zone coalesce(nullif(p_tz, ''), 'UTC')) at time zone coalesce(nullif(p_tz, ''), 'UTC');
exception when others then
  return date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
end;
$$;

-- What a card needs to draw a job or a profile.
create or replace function public.pp_job_card_json(j public.social_jobs)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', j.id, 'kind', 'job',
    'title', coalesce(nullif(btrim(j.job_title), ''), 'Job'),
    'company', nullif(btrim(j.company_name), ''),
    'poster', nullif(btrim(j.posted_by_name), ''),
    'avatar', nullif(btrim(j.avatar_url), ''),
    'location', nullif(btrim(j.location), ''),
    'pay', nullif(btrim(j.salary_range), ''),
    'rate_min', j.extracted_hourly_rate_min, 'rate_max', j.extracted_hourly_rate_max,
    'skills', coalesce(j.extracted_skills, '[]'::jsonb),
    'visas', coalesce(j.extracted_visa_types, '[]'::jsonb),
    'exp', j.extracted_experience_years,
    'type', nullif(btrim(j.employment_type), ''),
    'source', j.post_source,
    'post_url', j.post_url,
    'apply_url', case when j.post_source = 'career_site' then j.post_url end,
    'has_email', coalesce(btrim(j.poster_email), '') <> '',
    'posted_at', coalesce(j.posted_at, j.created_at),
    'open', coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null,
    'category', j.job_category,
    'logo_domain', case when j.post_source = 'career_site' then (
      select substring(cs.careers_url from '^https?://(?:www\.)?([^/:?#]+)')
      from public.career_sites cs
      where cs.slug = split_part(j.post_id, ':', 1) and cs.kind not in ('adzuna', 'jooble')
    ) end
  )
$$;

create or replace function public.pp_profile_card_json(h public.social_hotlist)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', h.id, 'kind', 'hotlist',
    'title', coalesce(nullif(btrim(h.role_title), ''), 'Profile'),
    'name', nullif(btrim(h.candidate_name), ''),
    'company', nullif(btrim(h.bench_sales_company_name), ''),
    'poster', nullif(btrim(h.bench_sales_recruiter_name), ''),
    'avatar', nullif(btrim(h.bench_sales_recruiter_avatar_url), ''),
    'location', nullif(array_to_string(h.locations, ', '), ''),
    'locations', to_jsonb(h.locations),
    'rate_min', h.hourly_rate_min, 'rate_max', h.hourly_rate_max,
    'skills', to_jsonb(h.core_skills),
    'visas', case when nullif(btrim(h.visa_type), '') is null then '[]'::jsonb else jsonb_build_array(btrim(h.visa_type)) end,
    'exp', h.years_experience,
    'type', nullif(btrim(h.employment_type), ''),
    'source', h.post_source,
    'post_url', h.post_url,
    'has_email', coalesce(btrim(h.bench_sales_recruiter_email), '') <> '',
    'posted_at', coalesce(h.posted_at, h.created_at),
    'open', coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null
  )
$$;

-- One card as Today, History and Tracker draw it.
create or replace function public.pp_card_item_json(c public.pipeline_cards)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'card_id', c.id, 'subject_id', c.subject_id, 'lead_id', c.lead_id, 'subject_kind', c.subject_kind,
    'fit', c.fit_score, 'similarity', round(c.similarity::numeric, 3),
    'stage', c.stage, 'closed_reason', c.closed_reason,
    'viewed_at', c.viewed_at, 'saved_at', c.saved_at, 'applied_at', c.applied_at, 'added_at', c.added_at,
    'reply_in_inbox', c.conversation_id is not null and exists (
      select 1 from public.vendor_messages m where m.conversation_id = c.conversation_id and m.direction = 'inbound'),
    'how', case when c.subject_kind = 'hotlist' and exists (
      select 1 from public.external_applications ea where ea.account_id = c.account_id and ea.social_job_id = c.lead_id) then 'site' else 'email' end,
    'subject', case when c.subject_kind = 'hotlist'
      then (select jsonb_build_object('title', h.role_title, 'name', h.candidate_name) from public.social_hotlist h where h.id = c.subject_id)
      else (select jsonb_build_object('title', j.job_title) from public.social_jobs j where j.id = c.subject_id) end,
    'lead', case when c.lead_kind = 'job'
      then (select public.pp_job_card_json(j) from public.social_jobs j where j.id = c.lead_id)
      else (select public.pp_profile_card_json(h) from public.social_hotlist h where h.id = c.lead_id) end
  )
$$;

revoke all on function public.pp_job_card_json(public.social_jobs) from public, anon, authenticated;
revoke all on function public.pp_profile_card_json(public.social_hotlist) from public, anon, authenticated;
revoke all on function public.pp_card_item_json(public.pipeline_cards) from public, anon, authenticated;

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
    'items', v_items
  );
end;
$$;

-- History: Viewed (opened before today, no action), Saved, Applied.
create or replace function public.get_history(p_kind text default 'hotlist', p_tab text default 'viewed', p_tz text default 'UTC')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_kind text := case when p_kind = 'job' then 'job' else 'hotlist' end;
  v_day timestamptz := public.pp_day_start(p_tz);
  v_items jsonb;
begin
  if v_account is null then return null; end if;
  select coalesce(jsonb_agg(public.pp_card_item_json(p) order by k.sort_at desc), '[]'::jsonb)
  into v_items
  from (
    select c.id, case p_tab when 'saved' then c.saved_at when 'applied' then c.applied_at else c.viewed_at end as sort_at
    from public.pipeline_cards c
    where c.account_id = v_account and c.subject_kind = v_kind
      and case p_tab
        when 'saved' then c.saved_at is not null and c.stage = 'new'
        when 'applied' then c.applied_at is not null
        else c.stage = 'new' and c.saved_at is null and c.viewed_at < v_day
      end
    order by sort_at desc
    limit 200
  ) k join public.pipeline_cards p on p.id = k.id;
  return jsonb_build_object(
    'tab', p_tab,
    'counts', (
      select jsonb_build_object(
        'viewed', count(*) filter (where c.stage = 'new' and c.saved_at is null and c.viewed_at < v_day),
        'saved', count(*) filter (where c.saved_at is not null and c.stage = 'new'),
        'applied', count(*) filter (where c.applied_at is not null))
      from public.pipeline_cards c where c.account_id = v_account and c.subject_kind = v_kind),
    'items', v_items
  );
end;
$$;

-- Tracker: live applications, then the past ones.
create or replace function public.get_tracker(p_kind text default 'hotlist')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_kind text := case when p_kind = 'job' then 'job' else 'hotlist' end;
  v_items jsonb;
begin
  if v_account is null then return null; end if;
  select coalesce(jsonb_agg(public.pp_card_item_json(p) order by k.applied_at desc), '[]'::jsonb)
  into v_items
  from (
    select c.id, c.applied_at from public.pipeline_cards c
    where c.account_id = v_account and c.subject_kind = v_kind and c.applied_at is not null
    order by c.applied_at desc
    limit 400
  ) k join public.pipeline_cards p on p.id = k.id;
  return jsonb_build_object(
    'counts', (
      select jsonb_build_object(
        'applied', count(*),
        'replied', count(*) filter (where c.stage in ('replied', 'interview', 'placed')),
        'interview', count(*) filter (where c.stage in ('interview', 'placed')),
        'placed', count(*) filter (where c.stage = 'placed'))
      from public.pipeline_cards c where c.account_id = v_account and c.subject_kind = v_kind and c.applied_at is not null),
    'items', v_items
  );
end;
$$;

-- Opening a card (or seeing it in swipe mode) marks it viewed, once.
create or replace function public.mark_cards_viewed(p_ids uuid[])
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_n integer;
begin
  update public.pipeline_cards c set viewed_at = now()
  where c.id = any(p_ids) and c.viewed_at is null
    and c.account_id = public.publisher_account_for_user(auth.uid());
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.set_card_saved(p_id uuid, p_saved boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.pipeline_cards c
  set saved_at = case when p_saved then coalesce(c.saved_at, now()) end,
      viewed_at = coalesce(c.viewed_at, now()), updated_at = now()
  where c.id = p_id and c.account_id = public.publisher_account_for_user(auth.uid());
  if not found then raise exception 'Card not found'; end if;
end;
$$;

-- Status from the Tracker's menu. Nobody has to set it: most change on their own.
create or replace function public.set_card_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_stage text;
  v_reason text;
begin
  case p_status
    when 'applied' then v_stage := 'submitted';
    when 'replied' then v_stage := 'replied';
    when 'interview' then v_stage := 'interview';
    when 'placed' then v_stage := 'placed';
    when 'not_selected' then v_stage := 'closed'; v_reason := 'not_selected';
    when 'no_response' then v_stage := 'closed'; v_reason := 'no_response';
    when 'job_closed' then v_stage := 'closed'; v_reason := 'job_closed';
    else raise exception 'Unknown status';
  end case;
  update public.pipeline_cards c
  set stage = v_stage, closed_reason = v_reason, stage_changed_at = now(), updated_at = now()
  where c.id = p_id and c.account_id = public.publisher_account_for_user(auth.uid());
  if not found then raise exception 'Card not found'; end if;
end;
$$;

revoke all on function public.get_today(text, text) from public, anon;
revoke all on function public.get_history(text, text, text) from public, anon;
revoke all on function public.get_tracker(text) from public, anon;
revoke all on function public.mark_cards_viewed(uuid[]) from public, anon;
revoke all on function public.set_card_saved(uuid, boolean) from public, anon;
revoke all on function public.set_card_status(uuid, text) from public, anon;
grant execute on function public.get_today(text, text) to authenticated;
grant execute on function public.get_history(text, text, text) to authenticated;
grant execute on function public.get_tracker(text) to authenticated;
grant execute on function public.mark_cards_viewed(uuid[]) to authenticated;
grant execute on function public.set_card_saved(uuid, boolean) to authenticated;
grant execute on function public.set_card_status(uuid, text) to authenticated;

-- Unopened, unsaved matches leave after 3 days.
create or replace function public.expire_unopened_matches()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_n integer;
begin
  update public.pipeline_cards c
  set stage = 'closed', closed_reason = 'expired', stage_changed_at = now(), updated_at = now()
  where c.stage = 'new' and c.viewed_at is null and c.saved_at is null
    and c.added_at < now() - interval '3 days'
    and not exists (select 1 from public.post_content_unlocks u where u.account_id = c.account_id and u.job_id = c.lead_id)
    and not exists (
      select 1 from public.pulse_lead_actions a
      where a.account_id = c.account_id and a.lead_id = c.lead_id::text and a.action_type = 'post_content_viewed'
    );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.expire_unopened_matches() from public, anon, authenticated;

-- Applications go quiet or their job closes: they move to Past.
create or replace function public.tracker_auto_past()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_a integer;
  v_b integer;
begin
  update public.pipeline_cards c
  set stage = 'closed', closed_reason = 'job_closed', stage_changed_at = now(), updated_at = now()
  from public.social_jobs j
  where c.lead_kind = 'job' and j.id = c.lead_id and c.stage = 'submitted'
    and (j.post_status = 'closed' or j.hidden_at is not null);
  get diagnostics v_a = row_count;
  update public.pipeline_cards c
  set stage = 'closed', closed_reason = 'no_response', stage_changed_at = now(), updated_at = now()
  where c.stage = 'submitted' and coalesce(c.applied_at, c.stage_changed_at) < now() - interval '14 days';
  get diagnostics v_b = row_count;
  return v_a + v_b;
end;
$$;
revoke all on function public.tracker_auto_past() from public, anon, authenticated;

select cron.unschedule('tracker-auto-past') where exists (select 1 from cron.job where jobname = 'tracker-auto-past');
select cron.schedule('tracker-auto-past', '40 2 * * *', 'select public.tracker_auto_past();');

-- Every application gets a Tracker card, including ones made outside Today.
create or replace function public.pipeline_card_for_application()
returns trigger language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  v_subject uuid;
  v_job uuid;
begin
  if tg_table_name = 'external_applications' then
    v_subject := new.subject_id;
    v_job := new.social_job_id;
  else
    if new.status not in ('completed', 'fulfilled') then return new; end if;
    v_subject := new.subject_hotlist_id;
    v_job := new.job_id;
  end if;
  if v_subject is null or v_job is null or new.account_id is null then return new; end if;
  if not exists (select 1 from public.social_hotlist h where h.id = v_subject and h.created_by_account_id = new.account_id) then
    return new;
  end if;
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, stage, similarity)
  values (new.account_id, 'hotlist', v_subject, 'job', v_job, 'submitted', coalesce((
    select (1 - (h.hotlist_embedding <=> j.job_embedding))::real
    from public.social_hotlist h, public.social_jobs j
    where h.id = v_subject and j.id = v_job and h.hotlist_embedding is not null and j.job_embedding is not null), 0.7))
  on conflict (subject_id, lead_id) do nothing;
  return new;
end;
$$;

drop trigger if exists pipeline_card_for_external_application on public.external_applications;
create trigger pipeline_card_for_external_application after insert on public.external_applications
  for each row execute function public.pipeline_card_for_application();
drop trigger if exists pipeline_card_for_ask_request on public.pulse_ask_ai_requests;
create trigger pipeline_card_for_ask_request after insert or update of status on public.pulse_ask_ai_requests
  for each row execute function public.pipeline_card_for_application();
