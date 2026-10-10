/*
# Matcher hotfix: read each account's minimum match once per consultant

The pay-per-match change read accounts.match_min_score with a scalar
sub-query in the subjects CTE; the planner evaluated it for every
consultant-job pair and the matcher hit its 2-minute timeout. Same function,
with the setting joined in once per consultant/requirement.
*/

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
      coalesce(pa.match_min_score, 70) as pref,
      case when h.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_hotlist h
    left join public.accounts pa on pa.id = h.created_by_account_id
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
      coalesce(pa.match_min_score, 70) as pref,
      case when j.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_jobs j
    left join public.accounts pa on pa.id = j.created_by_account_id
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
