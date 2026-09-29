-- Profiles moved from /p/:slug to /network/:slug. The "new subscriber"
-- notification links there now (the old address still redirects, so
-- notifications already sent keep working).
create or replace function public.notify_publisher_subscribed(p_publisher_id uuid, p_follower_account uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.publisher_profiles%rowtype;
  v_owner uuid;
  v_persona text;
  v_who text;
begin
  select * into v_profile from public.publisher_profiles where id = p_publisher_id;
  if not found or v_profile.claimed_account_id is null then return; end if;
  select a.owner_id into v_owner from public.accounts a where a.id = v_profile.claimed_account_id;
  if v_owner is null then return; end if;

  select a.active_persona into v_persona from public.accounts a where a.id = p_follower_account;
  v_who := case when v_persona = 'vendor' then 'A vendor' else 'A bench sales recruiter' end;

  insert into public.notifications (account_id, user_id, type, title, body, link)
  values (
    v_profile.claimed_account_id,
    v_owner,
    'publisher_subscribed',
    'New subscriber',
    v_who || ' subscribed to your ' || public.publisher_post_noun(v_profile.last_job_post_at, v_profile.last_hotlist_post_at) || '.',
    '/network/' || v_profile.slug
  );
end;
$$;

revoke all on function public.notify_publisher_subscribed(uuid, uuid) from public, anon, authenticated;
