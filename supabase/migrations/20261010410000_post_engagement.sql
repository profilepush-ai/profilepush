/*
# Views, applies, saves and shares on every post

Today shows how many people (accounts) have viewed, applied to, saved and
shared each match's post, across ProfilePush, so a busy post reads as urgent;
and it orders the list most viewed first, then best fit.

pp_lead_engagement(ids): those four counts for a set of posts.
  views   accounts that opened it (a Today/Tracker card, or the post itself)
  applies accounts that applied (by email or on the site) or asked for the resume
  saves   matches saved for later
  shares  accounts that shared it
*/

create index if not exists pipeline_cards_lead_idx on public.pipeline_cards (lead_id);
create index if not exists external_applications_job_idx on public.external_applications (social_job_id);
create index if not exists pulse_ask_ai_requests_job_idx on public.pulse_ask_ai_requests (job_id) where job_id is not null;

create or replace function public.pp_lead_engagement(p_ids uuid[])
returns table (lead_id uuid, views integer, applies integer, saves integer, shares integer)
language sql stable security definer set search_path to 'public' as $$
  with ids as (select distinct unnest(p_ids) as id),
  views as (
    select x.lead_id, count(distinct x.account_id)::int as n from (
      select c.lead_id, c.account_id from public.pipeline_cards c where c.lead_id = any(p_ids) and c.viewed_at is not null
      union
      select a.lead_id::uuid, a.account_id from public.pulse_lead_actions a
      where a.action_type = 'post_content_viewed' and a.lead_id = any(p_ids::text[]) and a.account_id is not null
    ) x group by x.lead_id
  ),
  applies as (
    select x.lead_id, count(distinct x.account_id)::int as n from (
      select c.lead_id, c.account_id from public.pipeline_cards c where c.lead_id = any(p_ids) and c.applied_at is not null
      union
      select ea.social_job_id, ea.account_id from public.external_applications ea where ea.social_job_id = any(p_ids)
      union
      select r.job_id, r.account_id from public.pulse_ask_ai_requests r where r.job_id = any(p_ids) and r.status in ('completed', 'fulfilled')
      union
      select r.hotlist_id, r.account_id from public.pulse_ask_ai_requests r where r.hotlist_id = any(p_ids) and r.status in ('completed', 'fulfilled')
    ) x group by x.lead_id
  ),
  saves as (
    select c.lead_id, count(*)::int as n from public.pipeline_cards c where c.lead_id = any(p_ids) and c.saved_at is not null group by c.lead_id
  ),
  shares as (
    select a.lead_id::uuid as lead_id, count(distinct a.account_id)::int as n from public.pulse_lead_actions a
    where a.action_type = 'shared' and a.lead_id = any(p_ids::text[]) group by a.lead_id
  )
  select ids.id, coalesce(v.n, 0), coalesce(ap.n, 0), coalesce(sv.n, 0), coalesce(sh.n, 0)
  from ids
  left join views v on v.lead_id = ids.id
  left join applies ap on ap.lead_id = ids.id
  left join saves sv on sv.lead_id = ids.id
  left join shares sh on sh.lead_id = ids.id
$$;
revoke all on function public.pp_lead_engagement(uuid[]) from public, anon, authenticated;

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
    select c.id, c.lead_id, c.fit_score, c.added_at
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
  , eng as (
    select * from public.pp_lead_engagement(array(select k.lead_id from picked k))
  )
  -- Most viewed first (what everyone else is looking at), then the best fit.
  select coalesce(jsonb_agg(public.pp_card_item_json(p) || jsonb_build_object(
      'duplicate', case when v_kind = 'hotlist' then public.submission_duplicate(v_account, p.subject_id, p.lead_id) end,
      'eng', jsonb_build_object('views', coalesce(e.views, 0), 'applies', coalesce(e.applies, 0), 'saves', coalesce(e.saves, 0), 'shares', coalesce(e.shares, 0)))
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
    'reel', public.pp_reel_stats(v_account, v_kind, p_tz)
  );
end;
$$;
