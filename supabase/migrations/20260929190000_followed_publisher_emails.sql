-- Which posters the viewer already subscribes to, as email keys, so every
-- card in a feed can show Subscribe / Subscribed from one request instead of
-- one per card. Feed rows already carry the poster's email (poster_email /
-- bench_sales_recruiter_email), so this exposes nothing the feed doesn't.
create or replace function public.get_followed_publisher_emails()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(p.email), '{}'::text[])
  from public.publisher_follows f
  join public.publisher_profiles p on p.id = f.publisher_id
  where f.account_id = public.publisher_account_for_user(auth.uid())
$$;

revoke all on function public.get_followed_publisher_emails() from public, anon;
grant execute on function public.get_followed_publisher_emails() to authenticated;
