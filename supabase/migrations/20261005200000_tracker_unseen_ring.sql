-- The Tracker's green ring meant "arrived in the last 30 minutes", so a match
-- added an hour before someone opened the Tracker showed no ring although
-- they had never seen it. It now means "added since your last visit".
--
-- added_at is when the card was put on the board. created_at can't serve:
-- the sparse top-up dates a card by its lead's post, which is usually days
-- before it was added.
--
-- A visit is a Tracker open more than 30 minutes after the previous one, so
-- a reload or a quick hop to another page keeps the rings instead of
-- clearing them.

alter table public.pipeline_cards add column if not exists added_at timestamptz;
update public.pipeline_cards set added_at = created_at where added_at is null;
alter table public.pipeline_cards alter column added_at set default now();
alter table public.pipeline_cards alter column added_at set not null;

create table if not exists public.tracker_visits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_open_at timestamptz not null,
  seen_until timestamptz
);
alter table public.tracker_visits enable row level security;
revoke all on public.tracker_visits from public, anon, authenticated;

-- Records a Tracker open and returns the cut-off for the ring: cards added
-- after it are new to this user. Null on a first visit, when nothing is
-- marked new.
create or replace function public.mark_tracker_visit()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.tracker_visits%rowtype;
  v_since timestamptz;
begin
  if auth.uid() is null then return null; end if;
  select * into v_row from public.tracker_visits where user_id = auth.uid() for update;
  if not found then
    insert into public.tracker_visits (user_id, last_open_at, seen_until) values (auth.uid(), now(), null);
    return null;
  end if;
  -- A new visit: everything up to the previous open has now been seen.
  v_since := case when v_row.last_open_at < now() - interval '30 minutes' then v_row.last_open_at else v_row.seen_until end;
  update public.tracker_visits set last_open_at = now(), seen_until = v_since where user_id = auth.uid();
  return v_since;
end;
$$;
revoke all on function public.mark_tracker_visit() from public, anon;
grant execute on function public.mark_tracker_visit() to authenticated;

-- Same as 20261004120000, plus added_at.
drop function if exists public.get_pipeline_board(text, text, timestamptz, timestamptz, uuid);
create function public.get_pipeline_board(
  p_kind text, p_stage text, p_since timestamptz, p_until timestamptz default null, p_subject_id uuid default null
)
returns table (
  subject_id uuid, id uuid, stage text, similarity real, conversation_id uuid, closed_reason text,
  created_at timestamptz, stage_changed_at timestamptz,
  lead_kind text, lead_id uuid, title text, location text, rate_min numeric, rate_max numeric,
  posted_at timestamptz, detail text, has_email boolean, added_at timestamptz
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
    case when c.lead_kind = 'job' then coalesce(btrim(j.poster_email), '') like '%@%' else coalesce(btrim(h.bench_sales_recruiter_email), '') like '%@%' end,
    c.added_at
  from ranked c
  left join public.social_jobs j on c.lead_kind = 'job' and j.id = c.lead_id
  left join public.social_hotlist h on c.lead_kind = 'hotlist' and h.id = c.lead_id
  where c.rn <= 100
    and (c.lead_kind = 'job' and j.id is not null and j.hidden_at is null
         or c.lead_kind = 'hotlist' and h.id is not null and h.hidden_at is null)
  order by c.subject_id, c.stage_changed_at desc, c.similarity desc nulls last;
$$;
revoke all on function public.get_pipeline_board(text, text, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_pipeline_board(text, text, timestamptz, timestamptz, uuid) to authenticated;
