-- AI Submit / AI Invite subscribes both sides to each other.
--
-- Sending to a post means you work with its poster, so the sender now
-- follows the poster's profile; and when the poster has joined, they follow
-- the sender back. Sends are recorded in two places:
--   pulse_ask_ai_requests  AI Submit / AI Invite on imported posts
--   job_applications       AI Submit on posts made in the app
--
-- Automatic follows are marked source = 'auto'. They don't count towards the
-- daily or total subscribe limits (those count publisher_follow_log, which
-- only manual subscribes write), and they send neither the "X subscribed to
-- you" email nor the in-app notice: the poster has just received the
-- submission itself. A failure here never blocks the send.

alter table public.publisher_follows
  add column if not exists source text not null default 'manual';

alter table public.publisher_follows
  drop constraint if exists publisher_follows_source_check;
alter table public.publisher_follows
  add constraint publisher_follows_source_check check (source in ('manual', 'auto'));

-- The subscriber email is for someone choosing to subscribe, not for the
-- follows a submission creates.
create or replace function public.email_unclaimed_publisher_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_service_role_key text := current_setting('app.service_role_key', true);
begin
  if new.source = 'auto' then
    return new;
  end if;
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

-- Both follows for one send.
create or replace function public.auto_follow_between(p_sender_account uuid, p_sender_user uuid, p_poster_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_poster_key text := public.publisher_email_key(p_poster_email);
  v_poster public.publisher_profiles%rowtype;
  v_sender_email text;
  v_sender_name text;
  v_sender_company text;
  v_sender_profile_id uuid;
begin
  if p_sender_account is null or v_poster_key = '' or position('@' in v_poster_key) = 0 then return; end if;

  select * into v_poster from public.publisher_profiles where email = v_poster_key;
  if not found then
    perform public.upsert_publisher_profile(v_poster_key, '', '', '', '', null, null);
    select * into v_poster from public.publisher_profiles where email = v_poster_key;
  end if;
  if not found or v_poster.claimed_account_id = p_sender_account then return; end if;

  -- Sender follows the poster.
  insert into public.publisher_follows (account_id, publisher_id, user_id, source)
  values (p_sender_account, v_poster.id, p_sender_user, 'auto')
  on conflict (account_id, publisher_id) do nothing;

  -- Poster follows the sender back, when the poster has joined.
  if v_poster.claimed_account_id is null then return; end if;

  select lower(trim(u.email)),
    coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), ''), '')
  into v_sender_email, v_sender_name
  from auth.users u where u.id = p_sender_user;
  if coalesce(v_sender_email, '') = '' then return; end if;
  select coalesce(nullif(trim(a.name), ''), '') into v_sender_company from public.accounts a where a.id = p_sender_account;

  v_sender_profile_id := public.upsert_publisher_profile(v_sender_email, v_sender_name, v_sender_company, '', '', null, null);
  if v_sender_profile_id is null then return; end if;

  insert into public.publisher_follows (account_id, publisher_id, user_id, source)
  values (v_poster.claimed_account_id, v_sender_profile_id, null, 'auto')
  on conflict (account_id, publisher_id) do nothing;
end;
$$;

revoke all on function public.auto_follow_between(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.auto_follow_on_ai_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  begin
    if new.job_id is not null then
      select j.poster_email into v_email from public.social_jobs j where j.id = new.job_id;
    elsif new.hotlist_id is not null then
      select h.bench_sales_recruiter_email into v_email from public.social_hotlist h where h.id = new.hotlist_id;
    end if;
    perform public.auto_follow_between(new.account_id, new.user_id, v_email);
  exception when others then
    raise warning 'Auto-subscribe skipped for AI request %: %', new.request_id, sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.auto_follow_on_job_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  begin
    select j.poster_email into v_email from public.social_jobs j where j.id = new.social_job_id;
    perform public.auto_follow_between(new.created_by_account_id, new.created_by_user_id, v_email);
  exception when others then
    raise warning 'Auto-subscribe skipped for application %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.auto_follow_on_ai_request() from public, anon, authenticated;
revoke all on function public.auto_follow_on_job_application() from public, anon, authenticated;

drop trigger if exists auto_follow_after_ai_request on public.pulse_ask_ai_requests;
create trigger auto_follow_after_ai_request
  after insert on public.pulse_ask_ai_requests
  for each row execute function public.auto_follow_on_ai_request();

drop trigger if exists auto_follow_after_job_application on public.job_applications;
create trigger auto_follow_after_job_application
  after insert on public.job_applications
  for each row execute function public.auto_follow_on_job_application();

-- The free plan's total cap counts subscriptions people chose, not the ones
-- their submissions created.
create or replace function public.get_follow_quota()
returns table (
  used_today integer,
  daily_limit integer,
  remaining integer,
  is_trial boolean,
  following_total integer,
  total_limit integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_trial boolean;
  v_used integer;
  v_limit integer;
  v_total integer;
  v_total_limit integer;
begin
  if v_account is null then
    return query select 0, 0, 0, true, 0, 0;
    return;
  end if;
  select coalesce(a.is_trial, true) into v_trial from public.accounts a where a.id = v_account;
  v_limit := case when v_trial then 5 else 10 end;
  v_total_limit := case when v_trial then 10 else null end;
  select count(*)::integer into v_used
  from public.publisher_follow_log l
  where l.account_id = v_account
    and l.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  select count(*)::integer into v_total
  from public.publisher_follows f
  where f.account_id = v_account and f.source = 'manual';
  return query select
    v_used,
    v_limit,
    greatest(0, least(
      v_limit - v_used,
      coalesce(v_total_limit - v_total, v_limit - v_used)
    )),
    v_trial,
    v_total,
    v_total_limit;
end;
$$;

revoke all on function public.get_follow_quota() from public, anon;
grant execute on function public.get_follow_quota() to authenticated;
