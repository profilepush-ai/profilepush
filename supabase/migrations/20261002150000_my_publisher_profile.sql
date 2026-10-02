-- The signed-in account's own claimed profile, for "My profile" in the
-- avatar menu. Nowhere else in the app links to it: Network leaves your own
-- profile out of Active and search.
create or replace function public.get_my_publisher_profile()
returns table (slug text, display_name text, company_name text, follower_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.slug, p.display_name, p.company_name,
    (select count(*)::integer from public.publisher_follows f where f.publisher_id = p.id)
  from public.publisher_profiles p
  where p.claimed_account_id = public.publisher_account_for_user(auth.uid())
    and p.removed_at is null
  order by greatest(p.last_job_post_at, p.last_hotlist_post_at) desc nulls last
  limit 1;
$$;

revoke all on function public.get_my_publisher_profile() from public, anon;
grant execute on function public.get_my_publisher_profile() to authenticated;
