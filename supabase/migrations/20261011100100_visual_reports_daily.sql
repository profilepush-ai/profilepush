/*
# Reports redraw a post's pictures at most once a day

Counted by reports, not by when the picture was drawn (most are new).
*/

create or replace function public.report_match_visual(p_lead uuid, p_url text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_user uuid := auth.uid();
  v_mine boolean;
begin
  if v_user is null then return jsonb_build_object('ok', false); end if;
  v_mine := p_url is not null and exists (select 1 from public.match_visuals_me m where m.lead_id = p_lead and m.user_id = v_user and m.url = p_url);
  -- Their own avatar picture: drawn again.
  if v_mine then
    update public.match_visuals_me set status = 'queued', attempts = 0 where lead_id = p_lead and user_id = v_user;
  -- The post's shared pictures: drawn again with a fresh scene, unless
  -- someone's report already did that in the last day.
  elsif not exists (select 1 from public.visual_reports r where r.lead_id = p_lead and r.created_at > now() - interval '1 day') then
    update public.match_visuals set status = 'queued', attempts = 0, template = null where lead_id = p_lead and status = 'done';
  end if;
  insert into public.visual_reports (user_id, lead_id, picture_url, reason)
  values (v_user, p_lead, left(p_url, 500), left(p_reason, 300))
  on conflict (user_id, lead_id) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.report_match_visual(uuid, text, text) from public, anon;
grant execute on function public.report_match_visual(uuid, text, text) to authenticated;
