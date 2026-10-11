/*
# Redrawn pictures don't blink out

A picture queued again (a new style, a redraw) keeps showing its current one
until the new one is done: cards read any picture that has a URL, not only
finished rows.
*/

create or replace function public.pp_lead_visuals(p_lead uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_object_agg(v.variant, v.url) from public.match_visuals v where v.lead_id = p_lead and v.url is not null
$$;
revoke all on function public.pp_lead_visuals(uuid) from public, anon, authenticated;
