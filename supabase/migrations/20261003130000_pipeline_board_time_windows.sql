-- Board time windows: New shows matches from the last 2 hours and the other
-- stages show today's moves by default, and each column can pick its own date
-- range. A card's time is when it was matched (New) or when it last changed
-- stage (every other tab). p_subject_id loads one column.

drop function if exists public.get_pipeline_board(text, text);
drop function if exists public.get_pipeline_stage_counts(text);

create or replace function public.get_pipeline_board(
  p_kind text, p_stage text, p_since timestamptz, p_until timestamptz default null, p_subject_id uuid default null
)
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
         else concat_ws(' · ', case when h.years_experience is not null then h.years_experience || ' yrs' end, nullif(trim(h.visa_type), '')) end
  from ranked c
  left join public.social_jobs j on c.lead_kind = 'job' and j.id = c.lead_id
  left join public.social_hotlist h on c.lead_kind = 'hotlist' and h.id = c.lead_id
  where c.rn <= 50
    and (c.lead_kind = 'job' and j.id is not null and j.hidden_at is null
         or c.lead_kind = 'hotlist' and h.id is not null and h.hidden_at is null)
  order by c.subject_id, c.stage_changed_at desc, c.similarity desc nulls last;
$$;

-- Tab counts in the default windows: New since p_new_since, the rest since p_since.
create or replace function public.get_pipeline_stage_counts(p_kind text, p_new_since timestamptz, p_since timestamptz)
returns table (stage text, n integer)
language sql
stable
security definer
set search_path = public
as $$
  select c.stage, count(*)::integer
  from public.pipeline_cards c
  where c.subject_kind = p_kind
    and case when c.stage = 'new' then c.created_at >= p_new_since else c.stage_changed_at >= p_since end
    and c.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active')
  group by c.stage;
$$;

revoke all on function public.get_pipeline_board(text, text, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.get_pipeline_stage_counts(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_pipeline_board(text, text, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.get_pipeline_stage_counts(text, timestamptz, timestamptz) to authenticated;
