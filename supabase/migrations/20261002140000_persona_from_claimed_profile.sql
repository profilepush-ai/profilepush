-- People who claim their profile from an email landed on the "vendor or
-- bench sales?" screen, and about a third left there. Their profile already
-- answers it: one that posts requirements is a vendor, one that posts
-- hotlists is bench sales (whichever they posted most recently). Whenever a
-- profile is claimed, by any path, an account with no user type gets it from
-- the profile. Accounts that already chose keep their choice.

create or replace function public.persona_from_profile(p public.publisher_profiles)
returns text
language sql
immutable
as $$
  select case
    when p.last_job_post_at is null and p.last_hotlist_post_at is null then null
    when coalesce(p.last_job_post_at, '-infinity') >= coalesce(p.last_hotlist_post_at, '-infinity') then 'vendor'
    else 'bench_sales'
  end;
$$;

create or replace function public.set_persona_on_profile_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.claimed_account_id is not null and old.claimed_account_id is distinct from new.claimed_account_id then
    update public.accounts a
    set active_persona = public.persona_from_profile(new)
    where a.id = new.claimed_account_id
      and a.active_persona is null
      and public.persona_from_profile(new) is not null;
  end if;
  return new;
end;
$$;

revoke all on function public.set_persona_on_profile_claim() from public, anon, authenticated;

drop trigger if exists set_persona_on_profile_claim on public.publisher_profiles;
create trigger set_persona_on_profile_claim
  after update of claimed_account_id on public.publisher_profiles
  for each row execute function public.set_persona_on_profile_claim();

-- The accounts already stuck on that screen.
update public.accounts a
set active_persona = public.persona_from_profile(p)
from public.publisher_profiles p
where p.claimed_account_id = a.id
  and a.active_persona is null
  and public.persona_from_profile(p) is not null;
