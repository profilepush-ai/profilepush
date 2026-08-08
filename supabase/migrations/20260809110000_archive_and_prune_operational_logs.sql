-- Archive and prune operational logs older than 14 days.
-- Runs daily at 02:00 UTC via pg_cron.

create table if not exists public.activity_logs_archive (
  like public.activity_logs including all
);

create table if not exists public.api_usage_log_archive (
  like public.api_usage_log including all
);

create table if not exists public.social_job_payload_logs_archive (
  like public.social_job_payload_logs including all
);

alter table public.activity_logs_archive
  add column if not exists archived_at timestamptz not null default now();

alter table public.api_usage_log_archive
  add column if not exists archived_at timestamptz not null default now();

alter table public.social_job_payload_logs_archive
  add column if not exists archived_at timestamptz not null default now();

create index if not exists idx_activity_logs_archive_created_at
  on public.activity_logs_archive (created_at desc);

create index if not exists idx_api_usage_log_archive_created_at
  on public.api_usage_log_archive (created_at desc);

create index if not exists idx_social_job_payload_logs_archive_created_at
  on public.social_job_payload_logs_archive (created_at desc);

create or replace function public.archive_and_prune_operational_logs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity_logs_archive
  select a.*, now() as archived_at
  from public.activity_logs a
  where a.created_at < now() - interval '14 days'
  on conflict (id) do nothing;

  delete from public.activity_logs
  where created_at < now() - interval '14 days';

  insert into public.api_usage_log_archive
  select u.*, now() as archived_at
  from public.api_usage_log u
  where u.created_at < now() - interval '14 days'
  on conflict (id) do nothing;

  delete from public.api_usage_log
  where created_at < now() - interval '14 days';

  insert into public.social_job_payload_logs_archive
  select s.*, now() as archived_at
  from public.social_job_payload_logs s
  where s.created_at < now() - interval '14 days'
  on conflict (id) do nothing;

  delete from public.social_job_payload_logs
  where created_at < now() - interval '14 days';
end;
$$;

grant execute on function public.archive_and_prune_operational_logs() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'archive-and-prune-logs-2am') then
    perform cron.unschedule('archive-and-prune-logs-2am');
  end if;
end
$$;

select cron.schedule(
  'archive-and-prune-logs-2am',
  '0 2 * * *',
  $$select public.archive_and_prune_operational_logs();$$
);
