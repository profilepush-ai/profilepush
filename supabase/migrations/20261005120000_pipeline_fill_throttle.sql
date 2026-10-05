-- Keep the 10-minute matcher fast. After reposts were removed, many columns
-- dropped under 5 cards and the top-up searched 30 days of posts for each of
-- them on every run (68 s), mostly finding reposts the dedupe trigger skips.
-- Now each column is topped up at most every 6 hours (a direct rematch still
-- runs at once), and it reads 4x the candidates it needs so skipped reposts
-- don't use up the slots.
create table if not exists public.pipeline_fill_tries (
  subject_id uuid primary key,
  tried_at timestamptz not null default now()
);
alter table public.pipeline_fill_tries enable row level security;

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
      where h.hidden_at is null and h.hotlist_embedding is not null and coalesce(h.post_status, 'open') = 'open'
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
revoke all on function public.fill_sparse_pipeline_columns(integer, real, uuid) from public, anon, authenticated;
