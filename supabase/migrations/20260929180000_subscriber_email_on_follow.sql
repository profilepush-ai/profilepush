-- Unclaimed publishers are emailed the moment someone subscribes, named:
-- "Priya Sharma subscribed to you on ProfilePush". One email per subscriber —
-- ten subscribers in a day is ten emails. This replaces the once-a-day count
-- email from 20260929170000.
--
-- A trigger on publisher_follows posts to the email worker through pg_net,
-- the same way push_inserted_notification (20260811130000) reaches
-- send-push-notification. The worker calls claim_subscriber_email back to get
-- the details; that call records the (publisher, subscriber) pair first, so
-- unsubscribing and subscribing again never sends a second email.

drop function if exists public.get_pending_subscriber_emails(integer);
drop function if exists public.mark_subscriber_emails_sent(jsonb);
alter table public.publisher_profiles
  drop column if exists subscribers_emailed_through,
  drop column if exists last_subscriber_email_at;

create table if not exists public.publisher_subscriber_emails (
  publisher_id uuid not null references public.publisher_profiles(id) on delete cascade,
  follower_account_id uuid not null references public.accounts(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (publisher_id, follower_account_id)
);

alter table public.publisher_subscriber_emails enable row level security;
revoke all on public.publisher_subscriber_emails from anon, authenticated;
grant select, insert, update, delete on public.publisher_subscriber_emails to service_role;

-- Everything the email needs, or nothing when it must not be sent: the
-- publisher has an account (they get the in-app notification instead),
-- unsubscribed here or from earlier outreach, or already heard about this
-- subscriber.
create or replace function public.claim_subscriber_email(p_publisher_id uuid, p_follower_account_id uuid)
returns table (
  email text,
  slug text,
  post_noun text,
  subscriber_name text,
  subscriber_company text,
  subscriber_count integer
)
language plpgsql
security definer
set search_path = public, auth
as $$
#variable_conflict use_column
declare
  v_profile public.publisher_profiles%rowtype;
  v_name text;
  v_company text;
begin
  select * into v_profile from public.publisher_profiles pp where pp.id = p_publisher_id;
  if not found
    or v_profile.claimed_account_id is not null
    or v_profile.email_opted_out
    or exists (select 1 from public.market_stats_email_sends m where lower(trim(m.email)) = v_profile.email and m.unsubscribed)
    or not exists (select 1 from public.publisher_follows f where f.publisher_id = p_publisher_id and f.account_id = p_follower_account_id)
  then
    return;
  end if;

  insert into public.publisher_subscriber_emails (publisher_id, follower_account_id)
  values (p_publisher_id, p_follower_account_id)
  on conflict do nothing;
  if not found then return; end if;

  -- The subscriber's name the way the rest of the platform shows it: the
  -- member's display name, else their sign-up name. The account name is
  -- their business, shown only when it isn't just their name again.
  select
    coalesce(nullif(trim(am.display_name), ''),
             nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
             nullif(trim(u.raw_user_meta_data->>'name'), ''),
             nullif(trim(a.name), ''),
             'A recruiter'),
    nullif(trim(a.name), '')
  into v_name, v_company
  from public.accounts a
  left join public.account_members am on am.account_id = a.id and am.user_id = a.owner_id
  left join auth.users u on u.id = a.owner_id
  where a.id = p_follower_account_id;

  if v_company is not null and lower(v_company) = lower(coalesce(v_name, '')) then
    v_company := null;
  end if;

  return query
  select v_profile.email, v_profile.slug,
    public.publisher_post_noun(v_profile.last_job_post_at, v_profile.last_hotlist_post_at),
    coalesce(v_name, 'A recruiter'), v_company,
    (select count(*)::integer from public.publisher_follows f where f.publisher_id = p_publisher_id);
end;
$$;

revoke all on function public.claim_subscriber_email(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_subscriber_email(uuid, uuid) to service_role;

create or replace function public.email_unclaimed_publisher_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_service_role_key text := current_setting('app.service_role_key', true);
begin
  -- Claimed publishers are notified in-app by follow_publisher; nothing to send.
  if exists (select 1 from public.publisher_profiles p where p.id = new.publisher_id and p.claimed_account_id is not null) then
    return new;
  end if;
  if coalesce(v_service_role_key, '') = '' then
    raise warning 'Subscriber email skipped because app.service_role_key is missing';
    return new;
  end if;

  begin
    perform net.http_post(
      url := 'https://profilepush-email-notifications.profilepush-ai.workers.dev/publisher-subscribed',
      body := jsonb_build_object('publisher_id', new.publisher_id, 'follower_account_id', new.account_id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'Failed to queue subscriber email for publisher %: %', new.publisher_id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.email_unclaimed_publisher_on_follow() from public, anon, authenticated;

drop trigger if exists email_unclaimed_publisher_after_follow on public.publisher_follows;
create trigger email_unclaimed_publisher_after_follow
  after insert on public.publisher_follows
  for each row execute function public.email_unclaimed_publisher_on_follow();
