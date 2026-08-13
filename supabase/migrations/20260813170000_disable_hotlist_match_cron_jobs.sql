-- The 2026-08-05 migration (20260805140000_deactivate_all_cron_jobs.sql) tried to
-- turn off these jobs but silently swallowed any cron.unschedule() failure, and
-- job-watch-trigger-social-30min kept firing every 30 minutes for the next 8 days,
-- repeatedly re-matching all active hotlist roles against Gemini and hitting rate
-- limits. This migration is not in use, so disable every cron job related to it
-- for real this time, matched by command text (robust against name drift) rather
-- than a hardcoded job name list, and record exactly what was found/removed.

create table if not exists public._cron_disable_audit (
  id uuid primary key default gen_random_uuid(),
  jobid bigint,
  jobname text,
  schedule text,
  was_active boolean,
  command text,
  disabled_at timestamptz not null default now()
);

alter table public._cron_disable_audit enable row level security;
revoke all on table public._cron_disable_audit from anon, authenticated;
grant select, insert on table public._cron_disable_audit to service_role;

do $$
declare
  r record;
begin
  for r in
    select jobid, jobname, schedule, active, command
    from cron.job
    where command ilike '%job-watch-trigger%'
       or command ilike '%daily-match-summary%'
       or command ilike '%send-daily-match-notification%'
       or command ilike '%purge-old-hotlist%'
  loop
    perform cron.unschedule(r.jobid);
    insert into public._cron_disable_audit (jobid, jobname, schedule, was_active, command)
    values (r.jobid, r.jobname, r.schedule, r.active, r.command);
  end loop;
end $$;
