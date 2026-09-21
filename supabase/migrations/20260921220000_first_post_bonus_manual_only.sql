-- The first-post bonus is for posting inventory deliberately.
--
-- It was granted by a trigger on social_hotlist/social_jobs, which fires for
-- every user post however it was created — including the one AI Match
-- publishes from the pasted text. A run charged 10 credits and the post it
-- created immediately granted 10 back, so the first run was silently free and
-- users reported their credits "not being used". The previous fix skipped
-- posts created within two minutes of a match charge, which worked but was a
-- heuristic sitting in the wrong place.
--
-- The RPCs cannot tell the two apart — AI Match calls the same
-- create_user_*_post functions the form does, with the same arguments — and
-- giving all three an extra parameter would mean recreating 400 lines of
-- post-creation SQL to carry one flag.
--
-- So the grant moves out of the database trigger and into the action that
-- earns it: the Add Post form claims it after a successful save. AI Match
-- never claims it, because it is not the form. Nothing else needs to know.

drop trigger if exists trg_grant_first_post_credits on public.social_hotlist;
drop trigger if exists trg_grant_first_post_credits on public.social_jobs;
drop function if exists public.grant_first_post_credits();

-- Claimed by the Add Post form. Idempotent through the milestone unique
-- index, and refuses to pay out unless the account genuinely has a post, so
-- calling it directly gains nothing.
create or replace function public.claim_first_post_bonus()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_has_post boolean;
begin
  if auth.uid() is null then
    return false;
  end if;

  select am.account_id into v_account_id
  from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active'
  order by am.created_at asc
  limit 1;

  if v_account_id is null then
    return false;
  end if;

  select exists (
    select 1 from public.social_hotlist h
    where h.created_by_account_id = v_account_id and h.post_source = 'user_post'
    union all
    select 1 from public.social_jobs j
    where j.created_by_account_id = v_account_id and j.post_source = 'user_post'
  ) into v_has_post;

  if not v_has_post then
    return false;
  end if;

  return public.grant_milestone_credits(
    v_account_id,
    'first_post',
    10,
    'Bonus: first post published'
  );
end;
$$;

revoke all on function public.claim_first_post_bonus() from public, anon;
grant execute on function public.claim_first_post_bonus() to authenticated;
