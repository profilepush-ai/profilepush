-- Telling publishers someone subscribed to them.
--
-- Claimed publishers get an in-app notification the moment it happens; the
-- notifications insert trigger (20260811130000) turns it into a push.
-- Unclaimed publishers have no account, so they get one email a day at most,
-- sent by the profilepush-email-notifications worker's daily cron: how many
-- people subscribed since the last email, and a link to claim the profile.
-- Subscribers are only ever counted, never named.

alter table public.publisher_profiles
  add column if not exists email_opted_out boolean not null default false,
  add column if not exists email_opted_out_at timestamptz,
  -- Follows created up to this time have already been announced by email.
  add column if not exists subscribers_emailed_through timestamptz,
  add column if not exists last_subscriber_email_at timestamptz;

-- What a publisher posts decides the words: a vendor posts requirements and is
-- followed by bench sales recruiters; a bench recruiter posts hotlists and is
-- followed by vendors. Whichever they posted most recently wins.
create or replace function public.publisher_post_noun(p_last_job timestamptz, p_last_hotlist timestamptz)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_last_hotlist, '-infinity') > coalesce(p_last_job, '-infinity') then 'hotlists'
    else 'requirements'
  end
$$;

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
    '/p/' || v_profile.slug
  );
end;
$$;

revoke all on function public.notify_publisher_subscribed(uuid, uuid) from public, anon, authenticated;

-- Same as 20260929120000, plus the notification once a new follow is saved.
create or replace function public.follow_publisher(p_publisher_id uuid)
returns table (following boolean, used_today integer, daily_limit integer, remaining integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  q record;
begin
  if v_account is null then
    raise exception 'No active account membership found';
  end if;
  if not exists (select 1 from public.publisher_profiles where id = p_publisher_id) then
    raise exception 'Publisher not found';
  end if;
  if exists (select 1 from public.publisher_profiles where id = p_publisher_id and claimed_account_id = v_account) then
    raise exception 'You cannot subscribe to your own profile';
  end if;

  if exists (select 1 from public.publisher_follows f where f.account_id = v_account and f.publisher_id = p_publisher_id) then
    select * into q from public.get_follow_quota();
    return query select true, q.used_today, q.daily_limit, q.remaining;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('publisher_follow:' || v_account::text));
  select * into q from public.get_follow_quota();
  if q.remaining <= 0 then
    raise exception 'FOLLOW_LIMIT_REACHED:%', q.daily_limit;
  end if;

  insert into public.publisher_follows (account_id, publisher_id, user_id)
  values (v_account, p_publisher_id, auth.uid())
  on conflict (account_id, publisher_id) do nothing;
  insert into public.publisher_follow_log (account_id, publisher_id) values (v_account, p_publisher_id);

  -- Best-effort: a failed notification must never undo the subscription.
  begin
    perform public.notify_publisher_subscribed(p_publisher_id, v_account);
  exception when others then
    null;
  end;

  return query select true, q.used_today + 1, q.daily_limit, greatest(0, q.remaining - 1);
end;
$$;

revoke all on function public.follow_publisher(uuid) from public, anon;
grant execute on function public.follow_publisher(uuid) to authenticated;

-- Unclaimed publishers with subscribers they haven't been told about, at most
-- one email per publisher per day. Skips anyone who unsubscribed here or from
-- the earlier outreach emails (market_stats_email_sends).
create or replace function public.get_pending_subscriber_emails(p_limit integer default 300)
returns table (
  publisher_id uuid,
  email text,
  slug text,
  new_count integer,
  total_count integer,
  post_noun text,
  follow_through timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.email, p.slug,
    count(*) filter (where f.created_at > coalesce(p.subscribers_emailed_through, '-infinity'))::integer,
    count(*)::integer,
    public.publisher_post_noun(p.last_job_post_at, p.last_hotlist_post_at),
    max(f.created_at)
  from public.publisher_profiles p
  join public.publisher_follows f on f.publisher_id = p.id
  where p.claimed_account_id is null
    and not p.email_opted_out
    and (p.last_subscriber_email_at is null or p.last_subscriber_email_at < now() - interval '20 hours')
    and not exists (
      select 1 from public.market_stats_email_sends m
      where lower(trim(m.email)) = p.email and m.unsubscribed
    )
  group by p.id
  having count(*) filter (where f.created_at > coalesce(p.subscribers_emailed_through, '-infinity')) > 0
  order by 4 desc, max(f.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 300), 2000))
$$;

create or replace function public.mark_subscriber_emails_sent(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.publisher_profiles p
  set subscribers_emailed_through = greatest(coalesce(p.subscribers_emailed_through, '-infinity'), (r->>'follow_through')::timestamptz),
      last_subscriber_email_at = now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where p.id = (r->>'publisher_id')::uuid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.publisher_email_opt_out(p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.publisher_profiles
  set email_opted_out = true, email_opted_out_at = now()
  where email = public.publisher_email_key(p_email)
$$;

revoke all on function public.get_pending_subscriber_emails(integer) from public, anon, authenticated;
revoke all on function public.mark_subscriber_emails_sent(jsonb) from public, anon, authenticated;
revoke all on function public.publisher_email_opt_out(text) from public, anon, authenticated;
grant execute on function public.get_pending_subscriber_emails(integer) to service_role;
grant execute on function public.mark_subscriber_emails_sent(jsonb) to service_role;
grant execute on function public.publisher_email_opt_out(text) to service_role;
