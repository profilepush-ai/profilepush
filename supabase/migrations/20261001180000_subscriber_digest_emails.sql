-- "X subscribed to you" for unclaimed publishers, as a daily batch.
--
-- The per-follow trigger (email_unclaimed_publisher_after_follow) never sent
-- anything: it needs app.service_role_key, which isn't set, so every call was
-- skipped. It's replaced by the email worker's daily run, which asks
-- get_pending_subscriber_digests for each unclaimed publisher with
-- subscribers they haven't been told about (manual or automatic), names the
-- newest, sends at most one email a day per publisher, and records each
-- announced subscriber in publisher_subscriber_emails so nobody is announced
-- twice.

drop trigger if exists email_unclaimed_publisher_after_follow on public.publisher_follows;

create or replace function public.get_pending_subscriber_digests(p_limit integer default 300)
returns table (
  publisher_id uuid,
  email text,
  slug text,
  display_name text,
  post_noun text,
  new_count integer,
  total_count integer,
  new_names text[],
  new_follower_ids uuid[]
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with candidates as (
    select p.*
    from public.publisher_profiles p
    where p.claimed_account_id is null
      and p.removed_at is null
      and not p.email_opted_out
      and not exists (
        select 1 from public.market_stats_email_sends m
        where lower(trim(m.email)) = p.email and m.unsubscribed
      )
      -- One email a day per publisher.
      and not exists (
        select 1 from public.publisher_subscriber_emails e
        where e.publisher_id = p.id and e.sent_at > now() - interval '20 hours'
      )
  ),
  new_follows as (
    select f.publisher_id, f.account_id, f.created_at,
      coalesce(nullif(trim(am.display_name), ''),
               nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
               nullif(trim(u.raw_user_meta_data->>'name'), ''),
               nullif(trim(a.name), ''),
               'A recruiter')
        || case when nullif(trim(a.name), '') is not null
                 and lower(trim(a.name)) <> lower(coalesce(nullif(trim(am.display_name), ''), nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), ''), ''))
                then ' (' || trim(a.name) || ')' else '' end as name
    from public.publisher_follows f
    join candidates c on c.id = f.publisher_id
    join public.accounts a on a.id = f.account_id
    left join public.account_members am on am.account_id = a.id and am.user_id = a.owner_id
    left join auth.users u on u.id = a.owner_id
    where not exists (
      select 1 from public.publisher_subscriber_emails e
      where e.publisher_id = f.publisher_id and e.follower_account_id = f.account_id
    )
  )
  select
    c.id, c.email, c.slug, c.display_name,
    case when coalesce(c.last_job_post_at, '-infinity') >= coalesce(c.last_hotlist_post_at, '-infinity') then 'requirements' else 'hotlists' end,
    count(nf.*)::integer,
    (select count(*)::integer from public.publisher_follows f2 where f2.publisher_id = c.id),
    (array_agg(nf.name order by nf.created_at desc))[1:3],
    array_agg(nf.account_id)
  from candidates c
  join new_follows nf on nf.publisher_id = c.id
  group by c.id, c.email, c.slug, c.display_name, c.last_job_post_at, c.last_hotlist_post_at
  order by count(nf.*) desc, max(nf.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 300), 2000));
$$;

-- Records the subscribers an email announced: [{publisher_id, follower_ids}].
create or replace function public.mark_subscriber_digests_sent(p_rows jsonb)
returns integer
language sql
security definer
set search_path = public
as $$
  with ins as (
    insert into public.publisher_subscriber_emails (publisher_id, follower_account_id)
    select (r->>'publisher_id')::uuid, fid::uuid
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r,
         jsonb_array_elements_text(r->'follower_ids') fid
    on conflict do nothing
    returning 1
  )
  select count(*)::integer from ins;
$$;

revoke all on function public.get_pending_subscriber_digests(integer) from public, anon, authenticated;
revoke all on function public.mark_subscriber_digests_sent(jsonb) from public, anon, authenticated;
grant execute on function public.get_pending_subscriber_digests(integer) to service_role;
grant execute on function public.mark_subscriber_digests_sent(jsonb) to service_role;
