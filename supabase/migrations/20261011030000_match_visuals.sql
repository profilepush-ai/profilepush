/*
# A picture for every match

Every match gets pictures, made once per post and shared by all of that post's
matches:
- a job gets two versions of the same scene, one with a woman (a) and one with
  a man (b), from a balanced list of personas that never depends on the job.
  The app shows each viewer one of them (picked per viewer and post).
- a consultant profile gets one picture with no person in it (its skills and
  its place), so nobody judges a real candidate by an invented face.

match_visuals holds them. Every new pipeline_cards row queues its post, and the
job-visual function drains the queue every minute. The drain only draws what a
match has queued, so it is safe to call without a secret.
JOB_VISUAL_DAILY_MAX (function secret, default 4000) caps images a day as a
safety net against a runaway loop.

job_visuals (five internal previews) is carried over here and no longer used.
*/

create table if not exists public.match_visuals (
  lead_id uuid not null,
  variant text not null check (variant in ('a', 'b')),
  lead_kind text not null check (lead_kind in ('job', 'hotlist')),
  status text not null default 'queued' check (status in ('queued', 'pending', 'done', 'failed')),
  url text,
  persona text,
  prompt text,
  model text,
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (lead_id, variant)
);
create index if not exists match_visuals_queue_idx on public.match_visuals (created_at desc) where status <> 'done';
create index if not exists match_visuals_done_day_idx on public.match_visuals (updated_at) where status = 'done';
alter table public.match_visuals enable row level security;
drop policy if exists match_visuals_read on public.match_visuals;
create policy match_visuals_read on public.match_visuals for select to authenticated using (true);

insert into public.match_visuals (lead_id, variant, lead_kind, status, url, persona, prompt, model, created_at, updated_at)
select v.job_id, case when v.persona like 'a man%' then 'b' else 'a' end, 'job', v.status, v.url, v.persona, v.prompt, v.model, v.created_at, v.updated_at
from public.job_visuals v where v.status = 'done'
on conflict (lead_id, variant) do nothing;

-- The finished pictures of a post: {"a": url, "b": url}, or null.
create or replace function public.pp_lead_visuals(p_lead uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_object_agg(v.variant, v.url) from public.match_visuals v where v.lead_id = p_lead and v.status = 'done'
$$;
revoke all on function public.pp_lead_visuals(uuid) from public, anon, authenticated;

create or replace function public.pp_job_card_json(j public.social_jobs)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', j.id, 'kind', 'job',
    'title', coalesce(nullif(btrim(j.job_title), ''), 'Job'),
    'company', nullif(btrim(j.company_name), ''),
    'poster', nullif(btrim(j.posted_by_name), ''),
    'avatar', nullif(btrim(j.avatar_url), ''),
    'location', nullif(btrim(j.location), ''),
    'pay', nullif(btrim(j.salary_range), ''),
    'rate_min', j.extracted_hourly_rate_min, 'rate_max', j.extracted_hourly_rate_max,
    'skills', coalesce(j.extracted_skills, '[]'::jsonb),
    'visas', coalesce(j.extracted_visa_types, '[]'::jsonb),
    'exp', j.extracted_experience_years,
    'type', nullif(btrim(j.employment_type), ''),
    'source', j.post_source,
    'post_url', j.post_url,
    'apply_url', case when j.post_source = 'career_site' then j.post_url end,
    'has_email', coalesce(btrim(j.poster_email), '') <> '',
    'posted_at', coalesce(j.posted_at, j.created_at),
    'open', coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null,
    'category', j.job_category,
    'visuals', public.pp_lead_visuals(j.id),
    'logo_domain', case when j.post_source = 'career_site' then (
      select substring(cs.careers_url from '^https?://(?:www\.)?([^/:?#]+)')
      from public.career_sites cs
      where cs.slug = split_part(j.post_id, ':', 1) and cs.kind not in ('adzuna', 'jooble')
    ) end
  )
$$;

create or replace function public.pp_profile_card_json(h public.social_hotlist)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', h.id, 'kind', 'hotlist',
    'title', coalesce(nullif(btrim(h.role_title), ''), 'Profile'),
    'name', nullif(btrim(h.candidate_name), ''),
    'company', nullif(btrim(h.bench_sales_company_name), ''),
    'poster', nullif(btrim(h.bench_sales_recruiter_name), ''),
    'avatar', nullif(btrim(h.bench_sales_recruiter_avatar_url), ''),
    'location', nullif(array_to_string(h.locations, ', '), ''),
    'locations', to_jsonb(h.locations),
    'rate_min', h.hourly_rate_min, 'rate_max', h.hourly_rate_max,
    'skills', to_jsonb(h.core_skills),
    'visas', case when nullif(btrim(h.visa_type), '') is null then '[]'::jsonb else jsonb_build_array(btrim(h.visa_type)) end,
    'exp', h.years_experience,
    'type', nullif(btrim(h.employment_type), ''),
    'source', h.post_source,
    'post_url', h.post_url,
    'has_email', coalesce(btrim(h.bench_sales_recruiter_email), '') <> '',
    'posted_at', coalesce(h.posted_at, h.created_at),
    'open', coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null,
    'visuals', public.pp_lead_visuals(h.id)
  )
$$;

-- Queue a post's pictures: two versions for a job, one for a profile.
create or replace function public.queue_match_visuals(p_kind text, p_lead uuid)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.match_visuals (lead_id, variant, lead_kind)
  select p_lead, v, p_kind from unnest(case when p_kind = 'job' then array['a', 'b'] else array['a'] end) v
  on conflict (lead_id, variant) do nothing;
$$;
revoke all on function public.queue_match_visuals(text, uuid) from public, anon, authenticated;

create or replace function public.match_visuals_on_card()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.queue_match_visuals(new.lead_kind, new.lead_id);
  return new;
end;
$$;
drop trigger if exists match_visuals_on_card on public.pipeline_cards;
create trigger match_visuals_on_card after insert on public.pipeline_cards
  for each row execute function public.match_visuals_on_card();

-- The worker takes the newest waiting pictures (so today's matches go first);
-- stuck ones come back after 10 minutes, failed ones get three tries.
create or replace function public.claim_match_visuals(p_limit integer)
returns setof public.match_visuals language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  update public.match_visuals m set status = 'pending', attempts = m.attempts + 1, error = null, updated_at = now()
  where (m.lead_id, m.variant) in (
    select q.lead_id, q.variant from public.match_visuals q
    where q.status = 'queued'
       or (q.status = 'pending' and q.updated_at < now() - interval '10 minutes' and q.attempts < 3)
       or (q.status = 'failed' and q.attempts < 3 and q.updated_at < now() - interval '30 minutes')
    order by q.created_at desc, q.lead_id, q.variant
    limit greatest(1, least(p_limit, 50))
    for update skip locked)
  returning m.*;
end;
$$;
revoke all on function public.claim_match_visuals(integer) from public, anon, authenticated;

select cron.unschedule('match-visuals-drain') where exists (select 1 from cron.job where jobname = 'match-visuals-drain');
select cron.schedule('match-visuals-drain', '* * * * *', $cron$
  select net.http_post(
    url := 'https://nhwqcqzvotgdngtxulwi.supabase.co/functions/v1/job-visual',
    body := '{"drain":true}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od3FjcXp2b3RnZG5ndHh1bHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjY3NDQsImV4cCI6MjA5NjQ0Mjc0NH0.DCPM9hZwqEsfmStT1beaUtp3P-uDVkCZL8xv0ZFpCss'),
    timeout_milliseconds := 150000
  );
$cron$);
