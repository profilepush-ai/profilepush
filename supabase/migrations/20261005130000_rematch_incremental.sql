-- Rematch (the column's refresh and pull to refresh) only checks posts the
-- column hasn't been checked against yet: those that came in since its last
-- rematch, instead of rescanning 7 days every time. It no longer runs the
-- 30-day top-up either; the 10-minute matcher does that, at most every 6
-- hours per column. (Matching compares stored embeddings in the database; no
-- AI calls or credits are involved.)
create table if not exists public.pipeline_match_cursor (
  subject_id uuid primary key,
  checked_at timestamptz not null default now()
);
alter table public.pipeline_match_cursor enable row level security;

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
        on h.hidden_at is null and h.hotlist_embedding is not null and coalesce(h.post_status, 'open') = 'open'
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
grant execute on function public.rematch_pipeline_subject(uuid) to authenticated;
