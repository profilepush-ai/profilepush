/*
# Avatars are for profiles only

The avatar is a person's photo on their profile, posts and Network profile;
match pictures are always the job's own. So no more personal match pictures:
a new match queues only its post's pictures, nothing re-queues today's
matches for someone's avatar, and the drawing queue hands out no personal
pictures (any still waiting are left undrawn).
*/

create or replace function public.match_visuals_on_card()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.queue_match_visuals(new.lead_kind, new.lead_id);
  return new;
end;
$$;

create or replace function public.queue_my_today_if_active(p_user uuid)
returns integer language sql security definer set search_path to 'public' as $$
  select 0
$$;
revoke all on function public.queue_my_today_if_active(uuid) from public, anon, authenticated;

create or replace function public.claim_my_visuals(p_limit integer)
returns setof public.match_visuals_me language sql security definer set search_path to 'public' as $$
  select * from public.match_visuals_me where false
$$;
revoke all on function public.claim_my_visuals(integer) from public, anon, authenticated;
