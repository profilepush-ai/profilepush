/*
# Reporting a picture

Every match picture carries an "AI illustration" note: it's an AI-made
example of the role, not a real person, and ProfilePush stands against
racism and discrimination. Anyone can report a picture that feels wrong.
A report redraws it: the viewer's own avatar picture, or the post's shared
pictures (at most once a day per post from reports). Reports are kept so
we can see what goes wrong.
*/

create table if not exists public.visual_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  lead_id uuid not null,
  picture_url text,
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, lead_id)
);
alter table public.visual_reports enable row level security;

create or replace function public.report_match_visual(p_lead uuid, p_url text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return jsonb_build_object('ok', false); end if;
  insert into public.visual_reports (user_id, lead_id, picture_url, reason)
  values (v_user, p_lead, left(p_url, 500), left(p_reason, 300))
  on conflict (user_id, lead_id) do nothing;
  -- Their own avatar picture: drawn again.
  update public.match_visuals_me set status = 'queued', attempts = 0
  where lead_id = p_lead and user_id = v_user and p_url is not null and url = p_url;
  -- The post's shared pictures: drawn again with a fresh scene, once a day.
  if not exists (select 1 from public.match_visuals_me m where m.lead_id = p_lead and m.user_id = v_user and m.url = p_url) then
    update public.match_visuals set status = 'queued', attempts = 0, template = null
    where lead_id = p_lead and status = 'done' and updated_at < now() - interval '1 day';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.report_match_visual(uuid, text, text) from public, anon;
grant execute on function public.report_match_visual(uuid, text, text) to authenticated;
