-- The Board: a pipeline per consultant (bench sales) or per requirement
-- (vendors), with every match as a card moving New -> Submitted -> Replied
-- -> Interview -> Closed.
--
-- Subjects are the account's own open posts: each consultant (a hotlist row)
-- or each requirement (a job). Leads are other people's posts that match a
-- subject: requirements for a consultant, consultants for a requirement,
-- using the same embeddings and 0.70 threshold as the morning brief.
--
-- run_pipeline_matcher (pg_cron, every 10 minutes) adds new matches as
-- cards in New; the board shows them live (realtime on pipeline_cards).
-- Sending an AI Submit / AI Invite moves the card to Submitted, and a vendor
-- reply in the conversation moves it to Replied. Interview and Closed are
-- set by the user (move_pipeline_card).

create table if not exists public.pipeline_cards (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('hotlist', 'job')),
  subject_id uuid not null,
  lead_kind text not null check (lead_kind in ('job', 'hotlist')),
  lead_id uuid not null,
  stage text not null default 'new' check (stage in ('new', 'submitted', 'replied', 'interview', 'closed')),
  similarity real,
  conversation_id uuid,
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stage_changed_at timestamptz not null default now(),
  unique (subject_id, lead_id)
);

create index if not exists pipeline_cards_account_subject_idx on public.pipeline_cards (account_id, subject_id, stage);
create index if not exists pipeline_cards_account_lead_idx on public.pipeline_cards (account_id, lead_id);

alter table public.pipeline_cards enable row level security;
revoke all on public.pipeline_cards from public, anon, authenticated;
grant select on public.pipeline_cards to authenticated;
grant select, insert, update, delete on public.pipeline_cards to service_role;

drop policy if exists pipeline_cards_select_own on public.pipeline_cards;
create policy pipeline_cards_select_own on public.pipeline_cards
  for select to authenticated
  using (account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active'));

-- Live updates for the board.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pipeline_cards') then
    alter publication supabase_realtime add table public.pipeline_cards;
  end if;
end $$;

-- Adds matches as New cards. p_lead_window: how far back to look for leads;
-- p_new_subjects_since: subjects created after this get p_backfill_window
-- instead, so a consultant posted today starts with this week's matches.
-- At most 15 new cards per subject per run, best first.
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

revoke all on function public.refresh_pipeline_cards(interval, timestamptz, interval) from public, anon, authenticated;

-- A card moves to Submitted when an AI Submit / AI Invite is sent for its
-- lead, and to Replied when the vendor writes back in that conversation.
create or replace function public.pipeline_card_on_vendor_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.vendor_conversations%rowtype;
begin
  select * into v_conv from public.vendor_conversations where id = new.conversation_id;
  if not found then return new; end if;
  if new.direction = 'outbound' then
    update public.pipeline_cards c
    set stage = 'submitted', stage_changed_at = now(), updated_at = now(), conversation_id = v_conv.id
    where c.account_id = v_conv.account_id
      and c.lead_id = coalesce(v_conv.job_id, v_conv.hotlist_id)
      and c.stage = 'new';
  elsif new.direction = 'inbound' then
    update public.pipeline_cards c
    set stage = 'replied', stage_changed_at = now(), updated_at = now(), conversation_id = v_conv.id
    where c.account_id = v_conv.account_id
      and c.lead_id = coalesce(v_conv.job_id, v_conv.hotlist_id)
      and c.stage in ('new', 'submitted');
  end if;
  return new;
end;
$$;

revoke all on function public.pipeline_card_on_vendor_message() from public, anon, authenticated;
drop trigger if exists pipeline_card_on_vendor_message on public.vendor_messages;
create trigger pipeline_card_on_vendor_message
  after insert on public.vendor_messages
  for each row execute function public.pipeline_card_on_vendor_message();

-- In-app submissions to a job posted in ProfilePush count as Submitted too.
create or replace function public.pipeline_card_on_job_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pipeline_cards c
  set stage = 'submitted', stage_changed_at = now(), updated_at = now()
  where c.account_id = new.created_by_account_id and c.lead_id = new.social_job_id and c.stage = 'new';
  return new;
end;
$$;

revoke all on function public.pipeline_card_on_job_application() from public, anon, authenticated;
drop trigger if exists pipeline_card_on_job_application on public.job_applications;
create trigger pipeline_card_on_job_application
  after insert on public.job_applications
  for each row execute function public.pipeline_card_on_job_application();

-- Moving a card by hand (drag, or Move to on a phone).
create or replace function public.move_pipeline_card(p_id uuid, p_stage text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_stage not in ('new', 'submitted', 'replied', 'interview', 'closed') then raise exception 'Unknown stage'; end if;
  update public.pipeline_cards c
  set stage = p_stage, stage_changed_at = now(), updated_at = now(),
      closed_reason = case when p_stage = 'closed' then left(coalesce(p_reason, 'closed'), 40) else null end
  where c.id = p_id
    and c.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active');
  if not found then raise exception 'Card not found'; end if;
end;
$$;

revoke all on function public.move_pipeline_card(uuid, text, text) from public, anon;
grant execute on function public.move_pipeline_card(uuid, text, text) to authenticated;

-- The board's tabs: the account's own open consultants (bench sales) or
-- requirements (vendors), with how many cards each has per stage.
create or replace function public.get_pipeline_subjects(p_kind text)
returns table (subject_id uuid, title text, detail text, created_at timestamptz, new_count integer, active_count integer)
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
      h.created_at
    from public.social_hotlist h, me
    where p_kind = 'hotlist' and h.created_by_account_id = me.account_id
      and h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
    union all
    select j.id, coalesce(nullif(trim(j.job_title), ''), 'Requirement'),
      concat_ws(' · ', nullif(trim(j.location), ''), nullif(trim(j.employment_type), '')),
      j.created_at
    from public.social_jobs j, me
    where p_kind = 'job' and j.created_by_account_id = me.account_id
      and j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
  )
  select s.id, s.title, s.detail, s.created_at,
    (select count(*)::integer from public.pipeline_cards c where c.subject_id = s.id and c.stage = 'new'),
    (select count(*)::integer from public.pipeline_cards c where c.subject_id = s.id and c.stage in ('submitted', 'replied', 'interview'))
  from subj s
  order by s.created_at desc;
$$;

-- One subject's cards with what each card shows.
create or replace function public.get_pipeline_cards(p_subject_id uuid)
returns table (
  id uuid, stage text, similarity real, conversation_id uuid, closed_reason text,
  created_at timestamptz, stage_changed_at timestamptz,
  lead_kind text, lead_id uuid, title text, location text, rate_min numeric, rate_max numeric,
  posted_at timestamptz, detail text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.stage, c.similarity, c.conversation_id, c.closed_reason, c.created_at, c.stage_changed_at,
    c.lead_kind, c.lead_id,
    case when c.lead_kind = 'job' then coalesce(nullif(trim(j.job_title), ''), 'Requirement') else coalesce(nullif(trim(h.role_title), ''), 'Consultant') end,
    case when c.lead_kind = 'job' then nullif(trim(j.location), '') else nullif(array_to_string(h.locations[1:2], ', '), '') end,
    case when c.lead_kind = 'job' then j.extracted_hourly_rate_min else h.hourly_rate_min end,
    case when c.lead_kind = 'job' then j.extracted_hourly_rate_max else h.hourly_rate_max end,
    case when c.lead_kind = 'job' then coalesce(j.posted_at, j.created_at) else coalesce(h.posted_at, h.created_at) end,
    case when c.lead_kind = 'job' then nullif(trim(j.employment_type), '')
         else concat_ws(' · ', case when h.years_experience is not null then h.years_experience || ' yrs' end, nullif(trim(h.visa_type), '')) end
  from public.pipeline_cards c
  left join public.social_jobs j on c.lead_kind = 'job' and j.id = c.lead_id
  left join public.social_hotlist h on c.lead_kind = 'hotlist' and h.id = c.lead_id
  where c.subject_id = p_subject_id
    and c.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active')
    and (c.lead_kind = 'job' and j.id is not null and j.hidden_at is null
         or c.lead_kind = 'hotlist' and h.id is not null and h.hidden_at is null)
  order by c.created_at desc
  limit 300;
$$;

revoke all on function public.get_pipeline_subjects(text) from public, anon;
revoke all on function public.get_pipeline_cards(uuid) from public, anon;
grant execute on function public.get_pipeline_subjects(text) to authenticated;
grant execute on function public.get_pipeline_cards(uuid) to authenticated;

-- Every 10 minutes: embed new hotlists (they're embedded on demand
-- otherwise), then add new matches.
create or replace function public.run_pipeline_matcher()
returns integer
language sql
security definer
set search_path = public, extensions
as $$
  select public.refresh_pipeline_cards(interval '36 hours', now() - interval '15 minutes', interval '7 days');
$$;

revoke all on function public.run_pipeline_matcher() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('pipeline-matcher', 'embed-new-hotlists');
select cron.schedule('embed-new-hotlists', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://nhwqcqzvotgdngtxulwi.supabase.co/functions/v1/ai-match',
    body := '{"mode":"embed_backlog"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od3FjcXp2b3RnZG5ndHh1bHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjY3NDQsImV4cCI6MjA5NjQ0Mjc0NH0.DCPM9hZwqEsfmStT1beaUtp3P-uDVkCZL8xv0ZFpCss'
    ),
    timeout_milliseconds := 120000
  );
$cron$);
select cron.schedule('pipeline-matcher', '3-59/10 * * * *', 'select public.run_pipeline_matcher();');

-- Start every board with this week's matches, and count what was already sent.
select public.refresh_pipeline_cards(interval '7 days', now() + interval '1 day', interval '7 days');

update public.pipeline_cards c
set stage = 'submitted', conversation_id = vc.id, stage_changed_at = vc.created_at
from public.vendor_conversations vc
where vc.account_id = c.account_id and coalesce(vc.job_id, vc.hotlist_id) = c.lead_id and c.stage = 'new';
