-- Admin > Emails > Conversations: everyone we've messaged, and each person's
-- full thread.
--
-- email_sends now keeps each email's content (the version before tracking,
-- so viewing it in admin never counts as the recipient opening it). Threads
-- also include in-app / push notifications (the notifications table) for
-- people who have an account.

alter table public.email_sends
  add column if not exists body_text text,
  add column if not exists body_html text;

-- One row per person we've emailed, most recent first.
--   p_filter: 'all' | 'users' | 'non_users'
create or replace function public.admin_conversation_list(
  p_search text default null,
  p_filter text default 'all',
  p_limit integer default 100
)
returns table (
  email text,
  name text,
  is_user boolean,
  last_at timestamptz,
  last_subject text,
  last_category text,
  email_count integer,
  opened_count integer,
  clicked_count integer
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with per_person as (
    select lower(s.to_email) as email,
      max(s.created_at) as last_at,
      (array_agg(s.subject order by s.created_at desc))[1] as last_subject,
      (array_agg(s.category order by s.created_at desc))[1] as last_category,
      count(*)::integer as email_count,
      count(*) filter (where s.opened_at is not null)::integer as opened_count,
      count(*) filter (where s.clicked_at is not null)::integer as clicked_count
    from public.email_sends s
    group by lower(s.to_email)
  ),
  named as (
    select pp.*,
      u.id is not null as is_user,
      coalesce(
        nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(trim(u.raw_user_meta_data->>'name'), ''),
        nullif(trim(pub.display_name), ''),
        nullif(trim(pub.company_name), '')
      ) as name
    from per_person pp
    left join auth.users u on lower(u.email) = pp.email
    left join public.publisher_profiles pub on pub.email = pp.email
  )
  select n.email, n.name, n.is_user, n.last_at, n.last_subject, n.last_category, n.email_count, n.opened_count, n.clicked_count
  from named n
  where (coalesce(p_filter, 'all') = 'all'
         or (p_filter = 'users' and n.is_user)
         or (p_filter = 'non_users' and not n.is_user))
    and (nullif(trim(coalesce(p_search, '')), '') is null
         or n.email ilike '%' || trim(p_search) || '%'
         or n.name ilike '%' || trim(p_search) || '%')
  order by n.last_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- Everything sent to one person, oldest first: emails (with content when
-- stored) and, for users, in-app / push notifications.
create or replace function public.admin_conversation_thread(p_email text)
returns table (
  kind text,
  id uuid,
  created_at timestamptz,
  category text,
  subject text,
  status text,
  provider text,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  body_text text,
  body_html text,
  link text,
  is_read boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select * from (
    select 'email'::text, s.id, s.created_at, s.category, s.subject, s.status, s.provider,
      s.delivered_at, s.opened_at, s.clicked_at, s.bounced_at, s.complained_at,
      s.body_text, s.body_html, null::text, null::boolean
    from public.email_sends s
    where lower(s.to_email) = lower(trim(p_email))
    union all
    select 'notification'::text, n.id, n.created_at, n.type, n.title, null, null,
      null, null, null, null, null,
      n.body, null, n.link, n.read
    from public.notifications n
    join auth.users u on u.id = n.user_id
    where lower(u.email) = lower(trim(p_email))
  ) t
  order by 3 desc
  limit 300;
$$;

revoke all on function public.admin_conversation_list(text, text, integer) from public, anon, authenticated;
revoke all on function public.admin_conversation_thread(text) from public, anon, authenticated;
grant execute on function public.admin_conversation_list(text, text, integer) to service_role;
grant execute on function public.admin_conversation_thread(text) to service_role;
