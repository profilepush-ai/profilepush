-- Board actions and two stages. Each column gets AI Match (seeded with the
-- post's text), Rematch (fresh matches for that one post, now) and bulk AI
-- Submit / Invite, which needs to know which cards have an email. The board
-- shows only New and Submitted (Invited for vendors).

drop function if exists public.get_pipeline_subjects(text);
create or replace function public.get_pipeline_subjects(p_kind text)
returns table (subject_id uuid, title text, detail text, created_at timestamptz, new_count integer, active_count integer, match_text text)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.publisher_account_for_user(auth.uid()) as account_id),
  subj as (
    select h.id, coalesce(nullif(trim(h.role_title), ''), 'Consultant') as title,
      concat_ws(' · ', nullif(array_to_string(h.core_skills[1:4], ', '), ''),
        case when h.years_experience is not null then h.years_experience || ' yrs' end,
        nullif(trim(h.visa_type), '')) as detail,
      h.created_at,
      -- One consultant spelled out (the original post can list several).
      concat_ws(' · ', nullif(trim(h.role_title), ''),
        nullif('Skills: ' || array_to_string(h.core_skills, ', '), 'Skills: '),
        case when h.years_experience is not null then h.years_experience || ' years' end,
        nullif(trim(h.visa_type), ''), nullif(array_to_string(h.locations, ', '), ''),
        nullif(trim(h.candidate_summary), '')) as match_text
    from public.social_hotlist h, me
    where p_kind = 'hotlist' and h.created_by_account_id = me.account_id
      and h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
    union all
    select j.id, coalesce(nullif(trim(j.job_title), ''), 'Requirement'),
      concat_ws(' · ', nullif(trim(j.location), ''), nullif(trim(j.employment_type), '')),
      j.created_at,
      coalesce(case when length(trim(coalesce(j.job_description, ''))) >= 40 then trim(j.job_description) end,
        concat_ws(' · ', j.job_title, j.location, (select string_agg(value, ', ') from jsonb_array_elements_text(case when jsonb_typeof(j.extracted_skills) = 'array' then j.extracted_skills else '[]'::jsonb end)), nullif(trim(j.employment_type), '')))
    from public.social_jobs j, me
    where p_kind = 'job' and j.created_by_account_id = me.account_id
      and j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
  )
  select s.id, s.title, s.detail, s.created_at,
    (select count(*)::integer from public.pipeline_cards c where c.subject_id = s.id and c.stage = 'new'),
    (select count(*)::integer from public.pipeline_cards c where c.subject_id = s.id and c.stage in ('submitted', 'replied', 'interview')),
    s.match_text
  from subj s
  order by s.created_at desc;
$$;

drop function if exists public.get_pipeline_board(text, text, timestamptz, timestamptz, uuid);
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
  where c.rn <= 50
    and (c.lead_kind = 'job' and j.id is not null and j.hidden_at is null
         or c.lead_kind = 'hotlist' and h.id is not null and h.hidden_at is null)
  order by c.subject_id, c.stage_changed_at desc, c.similarity desc nulls last;
$$;


-- Per-column counts for the two stages the board shows. Replied and
-- interview cards count as Submitted; skipped (closed) cards are off the board.
create or replace function public.get_pipeline_column_counts(p_kind text, p_new_since timestamptz, p_since timestamptz)
returns table (subject_id uuid, stage text, n integer)
language sql
stable
security definer
set search_path = public
as $$
  select c.subject_id, case when c.stage = 'new' then 'new' else 'submitted' end, count(*)::integer
  from public.pipeline_cards c
  where c.subject_kind = p_kind and c.stage <> 'closed'
    and case when c.stage = 'new' then c.created_at >= p_new_since else c.stage_changed_at >= p_since end
    and c.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active')
  group by 1, 2;
$$;

-- Rematch one column now: its top matches from the last 7 days that are not
-- on the board yet. Embedding similarity only, so it is instant and free.
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
  return v_added;
end;
$$;

revoke all on function public.get_pipeline_subjects(text) from public, anon;
revoke all on function public.get_pipeline_board(text, text, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.rematch_pipeline_subject(uuid) from public, anon;
grant execute on function public.get_pipeline_subjects(text) to authenticated;
grant execute on function public.get_pipeline_board(text, text, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.rematch_pipeline_subject(uuid) to authenticated;
