-- Tracker cards: no reposts, honest dates.
--
-- 1) A requirement or consultant posted again (same title, location and
-- contact) is one card per column. 998 of 4,785 job cards were reposts.
-- lead_key identifies a post across reposts; a card is skipped when its column
-- already holds that key, including one marked "Not a match".
-- 2) A card added for a post more than 2 days old is dated by the post, so an
-- old post found by a rematch is never "Just now" or a new-match alert.
-- 3) Rematch looks back 7 days again (the 30-day top-up stays for thin
-- columns only, in fill_sparse_pipeline_columns).

alter table public.pipeline_cards add column if not exists lead_key text;

create or replace function public.pipeline_lead_key(p_kind text, p_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case when p_kind = 'job' then (
    select lower(trim(coalesce(j.job_title, ''))) || '|' || lower(trim(coalesce(j.location, ''))) || '|' || lower(trim(coalesce(j.poster_email, j.company_name, '')))
    from public.social_jobs j where j.id = p_id)
  else (
    select lower(trim(coalesce(h.role_title, ''))) || '|' || lower(trim(coalesce(h.bench_sales_recruiter_email, ''))) || '|' || coalesce(h.years_experience::text, '')
    from public.social_hotlist h where h.id = p_id)
  end;
$$;

update public.pipeline_cards c set lead_key = public.pipeline_lead_key(c.lead_kind, c.lead_id) where c.lead_key is null;
create index if not exists pipeline_cards_subject_leadkey_idx on public.pipeline_cards (subject_id, lead_key);

-- Remove existing reposts: keep, per column and key, a card that moved past
-- New if there is one, else the strongest match, else the oldest.
delete from public.pipeline_cards c
using (
  select id, row_number() over (
    partition by subject_id, lead_key
    order by (stage <> 'new') desc, similarity desc nulls last, created_at
  ) as rn
  from public.pipeline_cards
  where lead_key is not null and lead_key <> '||'
) d
where c.id = d.id and d.rn > 1;

-- Re-date New cards that carry an insert time far after their post.
update public.pipeline_cards c
set created_at = x.at, stage_changed_at = x.at
from (
  select c2.id, coalesce(j.posted_at, j.created_at, h.posted_at, h.created_at) as at
  from public.pipeline_cards c2
  left join public.social_jobs j on c2.lead_kind = 'job' and j.id = c2.lead_id
  left join public.social_hotlist h on c2.lead_kind = 'hotlist' and h.id = c2.lead_id
  where c2.stage = 'new'
) x
where c.id = x.id and x.at is not null and c.created_at > x.at + interval '2 days';

create or replace function public.pipeline_card_dedupe_and_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  new.lead_key := public.pipeline_lead_key(new.lead_kind, new.lead_id);
  if new.lead_key is not null and new.lead_key <> '||' and exists (
    select 1 from public.pipeline_cards c where c.subject_id = new.subject_id and c.lead_key = new.lead_key
  ) then
    return null;  -- a repost already in this column
  end if;
  select case when new.lead_kind = 'job' then (select coalesce(j.posted_at, j.created_at) from public.social_jobs j where j.id = new.lead_id)
              else (select coalesce(h.posted_at, h.created_at) from public.social_hotlist h where h.id = new.lead_id) end
    into v_at;
  if v_at is not null and new.created_at > v_at + interval '2 days' then
    new.created_at := v_at;
    if new.stage = 'new' then new.stage_changed_at := v_at; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.pipeline_card_dedupe_and_date() from public, anon, authenticated;
-- Fires before pipeline_card_start_stage (alphabetical), which may move the card to Submitted.
drop trigger if exists pipeline_card_dedupe on public.pipeline_cards;
create trigger pipeline_card_dedupe
  before insert on public.pipeline_cards
  for each row execute function public.pipeline_card_dedupe_and_date();

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
       and coalesce(j.posted_at, j.created_at) >= now() - interval '7 days'
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
       and coalesce(h.posted_at, h.created_at) >= now() - interval '7 days'
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
