/*
# Career sites: list sites that have no supported job feed yet

kind 'none' = "needs adapter": the site is listed in /admin (paused) with a
note on its platform, but the worker never runs it.
*/
alter table public.career_sites drop constraint if exists career_sites_kind_check;
alter table public.career_sites add constraint career_sites_kind_check
  check (kind in ('builtin', 'sitemap_jsonld', 'jobdiva', 'greenhouse', 'lever', 'workday', 'none'));
