-- Ticks on the weekly "things to try" list in the admin Charts briefing.
--
-- Server-side rather than in the browser because this dashboard is handed to
-- several managers: a tick stored in localStorage would mean each of them sees
-- a different list and two people run the same experiment while a third is
-- never attempted. The whole point of the list is that the team can see what
-- has already been tried.
--
-- One row per experiment per ISO week. The week is stored rather than derived
-- so that history survives — "we tried this in week 39 and it did nothing" is
-- the useful part, and a rolling list would erase it.
--
-- No RLS policies on purpose: reads and writes go through the admin-checklist
-- edge function on the service-role key, which bypasses RLS. With the table
-- protected and no policy granting access, anon and authenticated cannot see
-- it at all.

create table if not exists public.admin_weekly_experiments (
  id uuid primary key default gen_random_uuid(),
  -- Monday of the ISO week, as YYYY-MM-DD.
  week_start date not null,
  -- Stable key from the experiment catalogue in the UI, not its wording, so
  -- rephrasing a suggestion does not orphan the ticks against it.
  experiment_key text not null,
  tried boolean not null default true,
  note text,
  updated_at timestamptz not null default now(),
  unique (week_start, experiment_key)
);

alter table public.admin_weekly_experiments enable row level security;

create index if not exists admin_weekly_experiments_week_idx
  on public.admin_weekly_experiments (week_start desc);
