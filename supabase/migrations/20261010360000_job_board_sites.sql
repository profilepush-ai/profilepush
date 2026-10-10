/*
# Job boards as career sites: Adzuna and Jooble

Two new site kinds read a job board's search API (keys are worker secrets:
ADZUNA_APP_ID / ADZUNA_APP_KEY, JOOBLE_API_KEY). Each job keeps its own
employer as the poster, and its link goes to the board's job page, so it is an
Apply job like any other career-site job. Jobs from firms whose own site is
already read are skipped by receive-career-jobs.

Seeded paused: switch each on in /admin once its key is set.
*/

alter table public.career_sites drop constraint if exists career_sites_kind_check;
alter table public.career_sites add constraint career_sites_kind_check
  check (kind in ('builtin', 'sitemap_jsonld', 'jobdiva', 'greenhouse', 'lever', 'workday', 'adzuna', 'jooble', 'none'));

insert into public.career_sites (slug, name, kind, config, careers_url, enabled, max_new_per_run, notes) values
  ('adzuna-it', 'Adzuna (IT contract)', 'adzuna', '{"category": "it-jobs"}', 'https://www.adzuna.com', false, 60,
   'Job board. US IT contract jobs from the last 3 days, 3 pages an hour. Needs ADZUNA_APP_ID and ADZUNA_APP_KEY.'),
  ('adzuna-healthcare', 'Adzuna (Healthcare contract)', 'adzuna', '{"category": "healthcare-nursing-jobs"}', 'https://www.adzuna.com', false, 60,
   'Job board. US healthcare contract jobs (Non-IT). Needs ADZUNA_APP_ID and ADZUNA_APP_KEY.'),
  ('jooble-it', 'Jooble (IT contract)', 'jooble', '{"keywords": "contract developer", "location": "USA"}', 'https://jooble.org', false, 60,
   'Job board. Needs JOOBLE_API_KEY.')
on conflict (slug) do nothing;
