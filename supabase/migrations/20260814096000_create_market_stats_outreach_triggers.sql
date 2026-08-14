-- Real-time triggers that notify the market-stats-outreach Cloudflare Worker
-- whenever a new scored job or hotlist row lands with a resolvable poster
-- email. Modeled on push_inserted_notification() in
-- 20260811130000_push_every_notification.sql — same SECURITY DEFINER +
-- net.http_post + BEGIN...EXCEPTION WHEN OTHERS pattern, so a webhook
-- failure never fails the insert.
--
-- Prerequisite (run once, outside this migration, alongside the existing
-- app.supabase_url / app.service_role_key settings):
--   alter database postgres set app.market_stats_worker_url = 'https://profilepush-market-stats-outreach.<account>.workers.dev/webhook/outreach';
--   alter database postgres set app.market_stats_webhook_token = '<TRIGGER_WEBHOOK_TOKEN value>';

create or replace function public.notify_market_stats_job_outreach()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_worker_url text := current_setting('app.market_stats_worker_url', true);
  v_webhook_token text := current_setting('app.market_stats_webhook_token', true);
  v_poster_email text;
begin
  select sj.poster_email into v_poster_email
  from public.social_jobs sj
  where sj.id = NEW.job_id;

  if coalesce(trim(v_poster_email), '') = '' then
    return NEW;
  end if;

  if coalesce(v_worker_url, '') = '' or coalesce(v_webhook_token, '') = '' then
    raise warning 'Market stats outreach webhook skipped: missing app.market_stats_worker_url/app.market_stats_webhook_token';
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

drop trigger if exists radar_match_results_market_stats_outreach on public.radar_match_results;
create trigger radar_match_results_market_stats_outreach
  after insert on public.radar_match_results
  for each row
  when (NEW.job_source = 'social')
  execute function public.notify_market_stats_job_outreach();

revoke all on function public.notify_market_stats_job_outreach() from public;

create or replace function public.notify_market_stats_hotlist_outreach()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_worker_url text := current_setting('app.market_stats_worker_url', true);
  v_webhook_token text := current_setting('app.market_stats_webhook_token', true);
  v_poster_email text;
begin
  select sh.bench_sales_recruiter_email into v_poster_email
  from public.social_hotlist sh
  where sh.id = NEW.hotlist_id;

  if coalesce(trim(v_poster_email), '') = '' then
    return NEW;
  end if;

  if coalesce(v_worker_url, '') = '' or coalesce(v_webhook_token, '') = '' then
    raise warning 'Market stats outreach webhook skipped: missing app.market_stats_worker_url/app.market_stats_webhook_token';
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

drop trigger if exists radar_match_hotlist_market_stats_outreach on public.radar_match_hotlist;
create trigger radar_match_hotlist_market_stats_outreach
  after insert on public.radar_match_hotlist
  for each row
  execute function public.notify_market_stats_hotlist_outreach();

revoke all on function public.notify_market_stats_hotlist_outreach() from public;
