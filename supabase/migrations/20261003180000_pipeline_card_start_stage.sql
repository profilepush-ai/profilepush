-- A match can reach the board after it was already emailed (an AI Submit or
-- AI Invite by Gmail or by ProfilePush email, a resume request, a chat, a job
-- application). Such a card starts in Submitted (Invited), on its
-- conversation, instead of New. Resume / AI Submit requests count for jobs
-- as well as consultants.

create or replace function public.pipeline_card_start_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv uuid;
  v_at timestamptz;
begin
  if new.stage <> 'new' then return new; end if;

  select vc.id, min(m.created_at) into v_conv, v_at
  from public.vendor_conversations vc
  join public.vendor_messages m on m.conversation_id = vc.id and m.direction = 'outbound'
  where vc.account_id = new.account_id and coalesce(vc.job_id, vc.hotlist_id) = new.lead_id
  group by vc.id
  order by min(m.created_at)
  limit 1;

  if v_conv is null then
    select min(x.at) into v_at from (
      select a.created_at as at from public.job_applications a
        where a.created_by_account_id = new.account_id and a.social_job_id = new.lead_id
      union all
      select r.created_at from public.pulse_ask_ai_requests r
        where r.account_id = new.account_id and coalesce(r.hotlist_id, r.job_id) = new.lead_id and r.status in ('completed', 'fulfilled')
      union all
      select t.created_at from public.post_chat_threads t
        where t.participant_account_id = new.account_id and t.hotlist_id = new.lead_id
    ) x;
    select t.id into v_conv from public.post_chat_threads t
      where t.participant_account_id = new.account_id and t.hotlist_id = new.lead_id
      order by t.created_at limit 1;
  end if;

  if v_at is not null then
    new.stage := 'submitted';
    new.stage_changed_at := v_at;
    new.conversation_id := coalesce(new.conversation_id, v_conv);
  end if;
  return new;
end;
$$;
revoke all on function public.pipeline_card_start_stage() from public, anon, authenticated;
drop trigger if exists pipeline_card_start_stage on public.pipeline_cards;
create trigger pipeline_card_start_stage
  before insert on public.pipeline_cards
  for each row execute function public.pipeline_card_start_stage();

-- Requests move cards for jobs too, not only consultants.
create or replace function public.pipeline_card_on_ask_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.hotlist_id, new.job_id) is not null and new.status in ('completed', 'fulfilled') then
    update public.pipeline_cards c
    set stage = 'submitted', stage_changed_at = now(), updated_at = now()
    where c.account_id = new.account_id and c.lead_id = coalesce(new.hotlist_id, new.job_id) and c.stage = 'new';
  end if;
  return new;
end;
$$;

-- Cards already in New that were emailed before they reached the board.
update public.pipeline_cards c
set stage = 'submitted', stage_changed_at = s.at, conversation_id = coalesce(c.conversation_id, s.conv), updated_at = now()
from (
  select vc.account_id, coalesce(vc.job_id, vc.hotlist_id) as lead_id, (array_agg(vc.id order by m.created_at))[1] as conv, min(m.created_at) as at
  from public.vendor_conversations vc
  join public.vendor_messages m on m.conversation_id = vc.id and m.direction = 'outbound'
  group by 1, 2
) s
where c.stage = 'new' and c.account_id = s.account_id and c.lead_id = s.lead_id;

update public.pipeline_cards c
set stage = 'submitted', stage_changed_at = s.at, updated_at = now()
from (
  select account_id, coalesce(hotlist_id, job_id) as lead_id, min(created_at) as at
  from public.pulse_ask_ai_requests
  where coalesce(hotlist_id, job_id) is not null and status in ('completed', 'fulfilled')
  group by 1, 2
  union all
  select created_by_account_id, social_job_id, min(created_at) from public.job_applications group by 1, 2
) s
where c.stage = 'new' and c.account_id = s.account_id and c.lead_id = s.lead_id;
