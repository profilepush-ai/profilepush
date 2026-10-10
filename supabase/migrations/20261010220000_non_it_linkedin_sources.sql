/*
# Non-IT LinkedIn sources

1. The Feed's LinkedIn branch now keeps US Non-IT requirements (healthcare,
   pharma, engineering, finance), as the career-site branch already does.
   Matching already pairs them with Non-IT consultants.
2. A one-week trial of healthcare and non-IT keyword searches and groups.
   Keep the ones where at least 20% of posts are requirements or hotlists
   with an email.
*/

do $$
declare
  v_def text := pg_get_viewdef('public.pulse_feed_jobs_rows'::regclass);
  v_old text := 'pp_job_lead_ok(social.country, social.job_category, social.job_title, social.location)';
  v_new text := '(pp_job_lead_ok(social.country, social.job_category, social.job_title, social.location) OR (social.job_category = ''Non-IT''::text AND COALESCE(social.country, ''US''::text) = ''US''::text AND NOT pp_is_recruiter_role(social.job_title)))';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'pulse_feed_jobs_rows: LinkedIn filter not found';
  end if;
  execute 'create or replace view public.pulse_feed_jobs_rows as ' || replace(v_def, v_old, v_new);
end $$;

insert into public.linkedin_keywords (keyword, is_active)
select k, true from unnest(array[
  'travel RN weekly gross',
  'travel nurse 13 weeks share your resume',
  'ICU RN travel contract',
  'Med Surg Telemetry travel RN',
  'L&D RN travel',
  'Cath Lab Tech CT Tech travel weekly',
  'Respiratory Therapist travel contract',
  'healthcare hotlist',
  'CSV validation engineer C2C',
  'Nurse Practitioner locum tenens C2C'
]) k
where not exists (select 1 from public.linkedin_keywords x where lower(x.keyword) = lower(k));

insert into public.linkedin_groups (group_id, group_name, is_active)
values
  ('1830558', 'RN Network - Nursing Community', true),
  ('90628', 'Nursing Network', true),
  ('2103800', 'Pharmaceutical Jobs Biotech Life Science Healthcare Pharma & Medical Devices Careers', true),
  ('2380308', 'Nursing Jobs', true),
  ('80327', 'Quality & Regulatory Network', true),
  ('3839864', 'Jobs for Accountants', true),
  ('834347', 'Engineering Career Opportunities (Jobs & Employment)', true)
on conflict (group_id) do nothing;
