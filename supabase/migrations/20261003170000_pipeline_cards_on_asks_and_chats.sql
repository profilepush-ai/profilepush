-- A vendor's resume request and a chat opened on a consultant count as an
-- invite too: move that consultant's card from New to Invited (submitted),
-- like an AI Invite email or a job application already does. A chat also
-- becomes the card's conversation (it opens at /inbox/<thread id>).

create or replace function public.pipeline_card_on_ask_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.hotlist_id is not null and new.status in ('completed', 'fulfilled') then
    update public.pipeline_cards c
    set stage = 'submitted', stage_changed_at = now(), updated_at = now()
    where c.account_id = new.account_id and c.lead_id = new.hotlist_id and c.stage = 'new';
  end if;
  return new;
end;
$$;
revoke all on function public.pipeline_card_on_ask_request() from public, anon, authenticated;
drop trigger if exists pipeline_card_on_ask_request on public.pulse_ask_ai_requests;
create trigger pipeline_card_on_ask_request
  after insert or update of status on public.pulse_ask_ai_requests
  for each row execute function public.pipeline_card_on_ask_request();

create or replace function public.pipeline_card_on_hotlist_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.post_kind = 'hotlist' and new.hotlist_id is not null then
    update public.pipeline_cards c
    set stage = case when c.stage = 'new' then 'submitted' else c.stage end,
        stage_changed_at = case when c.stage = 'new' then now() else c.stage_changed_at end,
        conversation_id = coalesce(c.conversation_id, new.id),
        updated_at = now()
    where c.account_id = new.participant_account_id and c.lead_id = new.hotlist_id;
  end if;
  return new;
end;
$$;
revoke all on function public.pipeline_card_on_hotlist_chat() from public, anon, authenticated;
drop trigger if exists pipeline_card_on_hotlist_chat on public.post_chat_threads;
create trigger pipeline_card_on_hotlist_chat
  after insert on public.post_chat_threads
  for each row execute function public.pipeline_card_on_hotlist_chat();

-- Cards whose request or chat went out before these triggers existed.
update public.pipeline_cards c
set stage = 'submitted', stage_changed_at = r.at, updated_at = now()
from (
  select account_id, hotlist_id, min(created_at) as at
  from public.pulse_ask_ai_requests
  where hotlist_id is not null and status in ('completed', 'fulfilled')
  group by account_id, hotlist_id
) r
where c.account_id = r.account_id and c.lead_id = r.hotlist_id and c.stage = 'new';

update public.pipeline_cards c
set stage = case when c.stage = 'new' then 'submitted' else c.stage end,
    stage_changed_at = case when c.stage = 'new' then t.at else c.stage_changed_at end,
    conversation_id = coalesce(c.conversation_id, t.id),
    updated_at = now()
from (
  select distinct on (participant_account_id, hotlist_id) participant_account_id, hotlist_id, id, created_at as at
  from public.post_chat_threads
  where post_kind = 'hotlist' and hotlist_id is not null
  order by participant_account_id, hotlist_id, created_at
) t
where c.account_id = t.participant_account_id and c.lead_id = t.hotlist_id
  and (c.stage = 'new' or c.conversation_id is null);
