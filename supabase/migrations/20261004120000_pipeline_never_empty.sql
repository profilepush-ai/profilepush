-- The Tracker's New tab should never look empty. Analysis on 2026-10-04:
-- every column was empty under the old 2-hour default, and 17 consultant and
-- 22 requirement columns had never had a match: their best candidates sat just
-- under the 0.70 cutoff or were older than the 7-day backfill.
--
-- fill_sparse_pipeline_columns tops up any open column with fewer than p_min
-- live cards with its closest leads from the last 30 days (similarity at least
-- p_floor). Anything under 0.70 is shown as "Closest available". A lead the
-- user marked "Not a match" (a closed card) is never added back.

create or replace function public.fill_sparse_pipeline_columns(p_min integer default 5, p_floor real default 0.50, p_subject uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s record;
  v_need integer;
  v_added integer := 0;
  v_rows integer;
begin
  -- Consultants -> requirements.
  for s in
    select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb,
      (select count(*) from public.pipeline_cards c where c.subject_id = h.id and c.stage <> 'closed') as live
    from public.social_hotlist h
    where h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
      and h.created_by_account_id is not null and h.hotlist_embedding is not null
      and (p_subject is null or h.id = p_subject)
  loop
    v_need := p_min - s.live;
    continue when v_need <= 0;
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity, created_at, stage_changed_at)
    select s.account_id, 'hotlist', s.id, 'job', x.id, x.sim, x.at, x.at
    from (
      select j.id, (1 - (s.emb <=> j.job_embedding))::real as sim, coalesce(j.posted_at, j.created_at) as at
      from public.social_jobs j
      where j.hidden_at is null and j.job_embedding is not null and coalesce(j.post_status, 'open') = 'open'
        and coalesce(j.posted_at, j.created_at) >= now() - interval '30 days'
        and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
        and j.created_by_account_id is distinct from s.account_id
        and not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = j.id)
      order by s.emb <=> j.job_embedding
      limit v_need
    ) x
    where x.sim >= p_floor
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_rows = row_count;
    v_added := v_added + v_rows;
  end loop;

  -- Requirements -> consultants.
  for s in
    select j.id, j.created_by_account_id as account_id, j.job_embedding as emb,
      (select count(*) from public.pipeline_cards c where c.subject_id = j.id and c.stage <> 'closed') as live
    from public.social_jobs j
    where j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
      and j.created_by_account_id is not null and j.job_embedding is not null
      and (p_subject is null or j.id = p_subject)
  loop
    v_need := p_min - s.live;
    continue when v_need <= 0;
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity, created_at, stage_changed_at)
    select s.account_id, 'job', s.id, 'hotlist', x.id, x.sim, x.at, x.at
    from (
      select h.id, (1 - (s.emb <=> h.hotlist_embedding))::real as sim, coalesce(h.posted_at, h.created_at) as at
      from public.social_hotlist h
      where h.hidden_at is null and h.hotlist_embedding is not null and coalesce(h.post_status, 'open') = 'open'
        and coalesce(h.posted_at, h.created_at) >= now() - interval '30 days'
        and h.created_by_account_id is distinct from s.account_id
        and not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = h.id)
      order by s.emb <=> h.hotlist_embedding
      limit v_need
    ) x
    where x.sim >= p_floor
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_rows = row_count;
    v_added := v_added + v_rows;
  end loop;
  return v_added;
end;
$$;
revoke all on function public.fill_sparse_pipeline_columns(integer, real, uuid) from public, anon, authenticated;

-- Every 10 minutes: fresh matches, then top up any thin column.
create or replace function public.run_pipeline_matcher()
returns integer
language sql
security definer
set search_path = public, extensions
as $$
  select public.refresh_pipeline_cards(interval '36 hours', now() - interval '15 minutes', interval '7 days')
       + public.fill_sparse_pipeline_columns(5, 0.50, null);
$$;
revoke all on function public.run_pipeline_matcher() from public, anon, authenticated;

-- Rematch (the column's refresh icon) looks back 30 days, then tops up.
create or replace function public.rematch_pipeline_subject(p_subject_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_added integer := 0;
  v_accounts uuid[];
begin
  select array_agg(am.account_id) into v_accounts
  from public.account_members am where am.user_id = auth.uid() and am.status = 'active';

  if exists (select 1 from public.social_hotlist h where h.id = p_subject_id and h.created_by_account_id = any(v_accounts)) then
    with s as (
      select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb
      from public.social_hotlist h where h.id = p_subject_id and h.hotlist_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, j.id as lead_id, (1 - (s.emb <=> j.job_embedding))::real as sim
      from s join public.social_jobs j
        on j.hidden_at is null and j.job_embedding is not null and coalesce(j.post_status, 'open') = 'open'
       and coalesce(j.posted_at, j.created_at) >= now() - interval '30 days'
       and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
       and j.created_by_account_id is distinct from s.account_id
      where not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = j.id)
      order by s.emb <=> j.job_embedding
      limit 15
    )
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
    select account_id, 'hotlist', subject_id, 'job', lead_id, sim from ranked where sim >= 0.70
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_added = row_count;
  elsif exists (select 1 from public.social_jobs j where j.id = p_subject_id and j.created_by_account_id = any(v_accounts)) then
    with s as (
      select j.id, j.created_by_account_id as account_id, j.job_embedding as emb
      from public.social_jobs j where j.id = p_subject_id and j.job_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, h.id as lead_id, (1 - (s.emb <=> h.hotlist_embedding))::real as sim
      from s join public.social_hotlist h
        on h.hidden_at is null and h.hotlist_embedding is not null and coalesce(h.post_status, 'open') = 'open'
       and coalesce(h.posted_at, h.created_at) >= now() - interval '30 days'
       and h.created_by_account_id is distinct from s.account_id
      where not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = h.id)
      order by s.emb <=> h.hotlist_embedding
      limit 15
    )
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
    select account_id, 'job', subject_id, 'hotlist', lead_id, sim from ranked where sim >= 0.70
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_added = row_count;
  else
    raise exception 'not your post';
  end if;
  -- Still thin after that: top it up with the closest available.
  v_added := v_added + public.fill_sparse_pipeline_columns(5, 0.50, p_subject_id);
  return v_added;
end;
$$;
grant execute on function public.rematch_pipeline_subject(uuid) to authenticated;

-- Columns now show every open match, so allow more per column.
create or replace function public.get_pipeline_board(
  p_kind text, p_stage text, p_since timestamptz, p_until timestamptz default null, p_subject_id uuid default null
)
returns table (
  subject_id uuid, id uuid, stage text, similarity real, conversation_id uuid, closed_reason text,
  created_at timestamptz, stage_changed_at timestamptz,
  lead_kind text, lead_id uuid, title text, location text, rate_min numeric, rate_max numeric,
  posted_at timestamptz, detail text, has_email boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select c.*, row_number() over (partition by c.subject_id order by c.stage_changed_at desc, c.similarity desc nulls last) as rn
    from public.pipeline_cards c
    where c.subject_kind = p_kind
      and (c.stage = p_stage or (p_stage = 'submitted' and c.stage in ('replied', 'interview')))
      and (p_subject_id is null or c.subject_id = p_subject_id)
      and case when p_stage = 'new' then c.created_at else c.stage_changed_at end >= p_since
      and (p_until is null or case when p_stage = 'new' then c.created_at else c.stage_changed_at end < p_until)
      and c.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active')
  )
  select c.subject_id, c.id, c.stage, c.similarity, c.conversation_id, c.closed_reason, c.created_at, c.stage_changed_at,
    c.lead_kind, c.lead_id,
    case when c.lead_kind = 'job' then coalesce(nullif(trim(j.job_title), ''), 'Requirement') else coalesce(nullif(trim(h.role_title), ''), 'Consultant') end,
    case when c.lead_kind = 'job' then nullif(trim(j.location), '') else nullif(array_to_string(h.locations[1:2], ', '), '') end,
    case when c.lead_kind = 'job' then j.extracted_hourly_rate_min else h.hourly_rate_min end,
    case when c.lead_kind = 'job' then j.extracted_hourly_rate_max else h.hourly_rate_max end,
    case when c.lead_kind = 'job' then coalesce(j.posted_at, j.created_at) else coalesce(h.posted_at, h.created_at) end,
    case when c.lead_kind = 'job' then nullif(trim(j.employment_type), '')
         else concat_ws(' · ', case when h.years_experience is not null then h.years_experience || ' yrs' end, nullif(trim(h.visa_type), '')) end,
    case when c.lead_kind = 'job' then coalesce(btrim(j.poster_email), '') like '%@%' else coalesce(btrim(h.bench_sales_recruiter_email), '') like '%@%' end
  from ranked c
  left join public.social_jobs j on c.lead_kind = 'job' and j.id = c.lead_id
  left join public.social_hotlist h on c.lead_kind = 'hotlist' and h.id = c.lead_id
  where c.rn <= 100
    and (c.lead_kind = 'job' and j.id is not null and j.hidden_at is null
         or c.lead_kind = 'hotlist' and h.id is not null and h.hidden_at is null)
  order by c.subject_id, c.stage_changed_at desc, c.similarity desc nulls last;
$$;

select public.fill_sparse_pipeline_columns(5, 0.50, null);
