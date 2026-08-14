-- The hosted `postgres` role on this project is not a superuser and cannot
-- run `alter database ... set app.xxx = ...` (confirmed: permission denied,
-- error 42501), unlike the app.supabase_url/app.service_role_key settings
-- referenced by older crons in this project, which must have been set
-- through a more privileged path. Store the two new outreach-webhook
-- settings in a small internal table instead — no special privilege needed,
-- and the actual secret token value is inserted separately via the service
-- role (never committed to a migration file).
create table if not exists public.market_stats_outreach_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.market_stats_outreach_config enable row level security;
grant select on public.market_stats_outreach_config to service_role;
-- No grants to authenticated/anon: holds the outreach webhook's shared
-- secret token. SECURITY DEFINER trigger functions owned by the table
-- owner bypass RLS by default, so they can still read this table.

create or replace function public.notify_market_stats_job_outreach()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_worker_url text := 'https://profilepush-market-stats-outreach.profilepush-ai.workers.dev/webhook/outreach';
  v_webhook_token text;
  v_poster_email text;
begin
  select value into v_webhook_token from public.market_stats_outreach_config where key = 'webhook_token';

  select sj.poster_email into v_poster_email
  from public.social_jobs sj
  where sj.id = NEW.job_id;

  if coalesce(trim(v_poster_email), '') = '' then
    return NEW;
  end if;

  if coalesce(v_webhook_token, '') = '' then
    raise warning 'Market stats outreach webhook skipped: missing market_stats_outreach_config.webhook_token';
    return NEW;
  end if;

  begin
    perform net.http_post(
      url := v_worker_url,
      body := jsonb_build_object(
        'source', 'job',
        'poster_email', v_poster_email,
        'job_id', NEW.job_id,
        'radar_match_id', NEW.id
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_webhook_token
      ),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'Failed to notify market stats outreach for radar_match_results %: %', NEW.id, SQLERRM;
  end;

  return NEW;
end;
$$;

create or replace function public.notify_market_stats_hotlist_outreach()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_worker_url text := 'https://profilepush-market-stats-outreach.profilepush-ai.workers.dev/webhook/outreach';
  v_webhook_token text;
  v_poster_email text;
begin
  select value into v_webhook_token from public.market_stats_outreach_config where key = 'webhook_token';

  select sh.bench_sales_recruiter_email into v_poster_email
  from public.social_hotlist sh
  where sh.id = NEW.hotlist_id;

  if coalesce(trim(v_poster_email), '') = '' then
    return NEW;
  end if;

  if coalesce(v_webhook_token, '') = '' then
    raise warning 'Market stats outreach webhook skipped: missing market_stats_outreach_config.webhook_token';
    return NEW;
  end if;

  begin
    perform net.http_post(
      url := v_worker_url,
      body := jsonb_build_object(
        'source', 'hotlist',
        'poster_email', v_poster_email,
        'hotlist_id', NEW.hotlist_id,
        'radar_match_id', NEW.id
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_webhook_token
      ),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'Failed to notify market stats outreach for radar_match_hotlist %: %', NEW.id, SQLERRM;
  end;

  return NEW;
end;
$$;
