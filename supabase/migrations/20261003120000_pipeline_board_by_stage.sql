-- Board view flipped: each consultant (or requirement) is a column and the
-- stage is a tab. These return one stage's cards across every subject, and
-- the per-stage counts for the tabs.

create or replace function public.get_pipeline_board(p_kind text, p_stage text)
returns table (
  subject_id uuid, id uuid, stage text, similarity real, conversation_id uuid, closed_reason text,
  created_at timestamptz, stage_changed_at timestamptz,
  lead_kind text, lead_id uuid, title text, location text, rate_min numeric, rate_max numeric,
  posted_at timestamptz, detail text
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select c.*, row_number() over (partition by c.subject_id order by c.stage_changed_at desc, c.similarity desc nulls last) as rn
    from public.pipeline_cards c
    where c.subject_kind = p_kind and c.stage = p_stage
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
         else concat_ws(' · ', case when h.years_experience is not null then h.years_experience || ' yrs' end, nullif(trim(h.visa_type), '')) end
  from ranked c
  left join public.social_jobs j on c.lead_kind = 'job' and j.id = c.lead_id
  left join public.social_hotlist h on c.lead_kind = 'hotlist' and h.id = c.lead_id
  where c.rn <= 50
    and (c.lead_kind = 'job' and j.id is not null and j.hidden_at is null
         or c.lead_kind = 'hotlist' and h.id is not null and h.hidden_at is null)
  order by c.subject_id, c.stage_changed_at desc, c.similarity desc nulls last;
$$;

create or replace function public.get_pipeline_stage_counts(p_kind text)
returns table (stage text, n integer)
language sql
stable
security definer
set search_path = public
as $$
  select c.stage, count(*)::integer
  from public.pipeline_cards c
  where c.subject_kind = p_kind
    and c.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active')
  group by c.stage;
$$;

revoke all on function public.get_pipeline_board(text, text) from public, anon;
revoke all on function public.get_pipeline_stage_counts(text) from public, anon;
grant execute on function public.get_pipeline_board(text, text) to authenticated;
grant execute on function public.get_pipeline_stage_counts(text) to authenticated;
