-- Consultant matches follow the same rule requirement matches already do:
-- a scraped post is only matched when it has someone to email. A scraped
-- consultant with no bench sales recruiter email can't receive an AI
-- Request, yet each match costs the vendor a credit (charge_tracker_match).
-- Posts made in the app still match either way.
--
-- Applied where the leads are chosen (fresh matches, the sparse-column
-- top-up and Rematch), so an unsendable consultant never takes a slot a
-- sendable one could have had. Cards already on boards are left alone.

-- refresh_pipeline_cards: as in 20261003110000_pipeline_board.sql, plus the consultant email rule.
create or replace function public.refresh_pipeline_cards(
  p_lead_window interval default interval '36 hours',
  p_new_subjects_since timestamptz default now() - interval '1 hour',
  p_backfill_window interval default interval '7 days'
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer := 0;
  v_added integer;
begin
  -- Consultants -> requirements.
  with subjects as (
    select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb,
      case when h.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_hotlist h
    where h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
      and h.created_by_account_id is not null and h.hotlist_embedding is not null
  ),
  leads as (
    select j.id, j.job_embedding as emb, coalesce(j.posted_at, j.created_at) as at, j.created_by_account_id
    from public.social_jobs j
    where j.hidden_at is null and j.job_embedding is not null
      and coalesce(j.post_status, 'open') = 'open'
      and coalesce(j.posted_at, j.created_at) >= now() - p_backfill_window
      and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
  ),
  pairs as (
    select s.account_id, s.id as subject_id, l.id as lead_id, (1 - (s.emb <=> l.emb))::real as sim
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
  ),
  ranked as (
    select p.*, row_number() over (partition by p.subject_id order by p.sim desc) as rn
    from pairs p
    where p.sim >= 0.70
      and not exists (select 1 from public.pipeline_cards c where c.subject_id = p.subject_id and c.lead_id = p.lead_id)
  )
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
  select account_id, 'hotlist', subject_id, 'job', lead_id, sim from ranked where rn <= 15
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  -- Requirements -> consultants.
  with subjects as (
    select j.id, j.created_by_account_id as account_id, j.job_embedding as emb,
      case when j.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_jobs j
    where j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
      and j.created_by_account_id is not null and j.job_embedding is not null
  ),
  leads as (
    select h.id, h.hotlist_embedding as emb, coalesce(h.posted_at, h.created_at) as at, h.created_by_account_id
    from public.social_hotlist h
    where h.hidden_at is null and h.hotlist_embedding is not null
       and (h.post_source <> 'linkedin_scrape' or coalesce(btrim(h.bench_sales_recruiter_email), '') <> '')
      and coalesce(h.post_status, 'open') = 'open'
      and coalesce(h.posted_at, h.created_at) >= now() - p_backfill_window
  ),
  pairs as (
    select s.account_id, s.id as subject_id, l.id as lead_id, (1 - (s.emb <=> l.emb))::real as sim
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
  ),
  ranked as (
    select p.*, row_number() over (partition by p.subject_id order by p.sim desc) as rn
    from pairs p
    where p.sim >= 0.70
      and not exists (select 1 from public.pipeline_cards c where c.subject_id = p.subject_id and c.lead_id = p.lead_id)
  )
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
  select account_id, 'job', subject_id, 'hotlist', lead_id, sim from ranked where rn <= 15
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  return v_count;
end;
$$;

-- fill_sparse_pipeline_columns: as in 20261005120000_pipeline_fill_throttle.sql, plus the consultant email rule.
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
      and (p_subject is not null or not exists (select 1 from public.pipeline_fill_tries t where t.subject_id = h.id and t.tried_at > now() - interval '6 hours'))
  loop
    v_need := p_min - s.live;
    continue when v_need <= 0;
    insert into public.pipeline_fill_tries (subject_id, tried_at) values (s.id, now())
    on conflict (subject_id) do update set tried_at = now();
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
      limit v_need * 4
    ) x
    where x.sim >= p_floor
    order by x.sim desc
    limit v_need
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
      and (p_subject is not null or not exists (select 1 from public.pipeline_fill_tries t where t.subject_id = j.id and t.tried_at > now() - interval '6 hours'))
  loop
    v_need := p_min - s.live;
    continue when v_need <= 0;
    insert into public.pipeline_fill_tries (subject_id, tried_at) values (s.id, now())
    on conflict (subject_id) do update set tried_at = now();
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity, created_at, stage_changed_at)
    select s.account_id, 'job', s.id, 'hotlist', x.id, x.sim, x.at, x.at
    from (
      select h.id, (1 - (s.emb <=> h.hotlist_embedding))::real as sim, coalesce(h.posted_at, h.created_at) as at
      from public.social_hotlist h
      where h.hidden_at is null and h.hotlist_embedding is not null
       and (h.post_source <> 'linkedin_scrape' or coalesce(btrim(h.bench_sales_recruiter_email), '') <> '') and coalesce(h.post_status, 'open') = 'open'
        and coalesce(h.posted_at, h.created_at) >= now() - interval '30 days'
        and h.created_by_account_id is distinct from s.account_id
        and not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = h.id)
      order by s.emb <=> h.hotlist_embedding
      limit v_need * 4
    ) x
    where x.sim >= p_floor
    order by x.sim desc
    limit v_need
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_rows = row_count;
    v_added := v_added + v_rows;
  end loop;
  return v_added;
end;
$$;

-- rematch_pipeline_subject: as in 20261005130000_rematch_incremental.sql, plus the consultant email rule.
create or replace function public.rematch_pipeline_subject(p_subject_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_added integer := 0;
  v_accounts uuid[];
  v_since timestamptz;
begin
  -- Only posts this column hasn't been checked against: those that came in
  -- since its last rematch (30-minute overlap for posts still being embedded),
  -- or the last 36 hours the first time, which the 10-minute matcher already
  -- covers anyway.
  select coalesce(max(m.checked_at), now() - interval '36 hours') - interval '30 minutes' into v_since
  from public.pipeline_match_cursor m where m.subject_id = p_subject_id;
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
       and j.created_at >= v_since
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
        on h.hidden_at is null and h.hotlist_embedding is not null
       and (h.post_source <> 'linkedin_scrape' or coalesce(btrim(h.bench_sales_recruiter_email), '') <> '') and coalesce(h.post_status, 'open') = 'open'
       and h.created_at >= v_since
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
  insert into public.pipeline_match_cursor (subject_id, checked_at) values (p_subject_id, now())
  on conflict (subject_id) do update set checked_at = now();
  return v_added;
end;
$$;
