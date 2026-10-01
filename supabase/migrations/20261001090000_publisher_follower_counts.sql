-- Subscriber counts for a set of publishers, for the Popular / Top badges on
-- Network cards and search results (the Active list and profile pages already
-- carry their own count). Counts only; never who subscribed.
create or replace function public.get_publisher_follower_counts(p_ids uuid[])
returns table (publisher_id uuid, follower_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select f.publisher_id, count(*)::integer
  from public.publisher_follows f
  where f.publisher_id = any(coalesce(p_ids, '{}'))
  group by f.publisher_id
$$;

revoke all on function public.get_publisher_follower_counts(uuid[]) from public, anon;
grant execute on function public.get_publisher_follower_counts(uuid[]) to authenticated;
