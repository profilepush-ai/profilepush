-- Counts for the All / Users / Not users pills in Admin > Emails >
-- Conversations, matching the same search as the list.
create or replace function public.admin_conversation_counts(p_search text default null)
returns table (all_count integer, users_count integer, non_users_count integer)
language sql
stable
security definer
set search_path = public, auth
as $$
  with people as (
    select lower(s.to_email) as email
    from public.email_sends s
    group by lower(s.to_email)
  ),
  named as (
    select p.email,
      u.id is not null as is_user,
      coalesce(
        nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(trim(u.raw_user_meta_data->>'name'), ''),
        nullif(trim(pub.display_name), ''),
        nullif(trim(pub.company_name), '')
      ) as name
    from people p
    left join auth.users u on lower(u.email) = p.email
    left join public.publisher_profiles pub on pub.email = p.email
  ),
  matched as (
    select * from named n
    where nullif(trim(coalesce(p_search, '')), '') is null
       or n.email ilike '%' || trim(p_search) || '%'
       or n.name ilike '%' || trim(p_search) || '%'
  )
  select count(*)::integer, count(*) filter (where is_user)::integer, count(*) filter (where not is_user)::integer
  from matched;
$$;

revoke all on function public.admin_conversation_counts(text) from public, anon, authenticated;
grant execute on function public.admin_conversation_counts(text) to service_role;
