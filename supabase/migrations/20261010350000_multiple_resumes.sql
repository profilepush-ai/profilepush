/*
# Several resumes per consultant

hotlist_resume_files keeps every resume uploaded for a consultant (seeded with
the one each had). hotlist_resumes stays the default, so everything that
attaches "the resume" keeps working. Uploading adds a resume; the first one
becomes the default. Make any one the default, or delete one (deleting the
default promotes the newest remaining). Today's queue returns the list, and a
send can name which one to attach.
*/

create table if not exists public.hotlist_resume_files (
  id uuid primary key default gen_random_uuid(),
  hotlist_id uuid not null references public.social_hotlist(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  url text not null,
  file_name text not null,
  uploaded_at timestamptz not null default now()
);
create index if not exists hotlist_resume_files_hotlist_idx on public.hotlist_resume_files (hotlist_id, uploaded_at desc);
alter table public.hotlist_resume_files enable row level security;
drop policy if exists hotlist_resume_files_select on public.hotlist_resume_files;
create policy hotlist_resume_files_select on public.hotlist_resume_files for select to authenticated
  using (account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active'));

insert into public.hotlist_resume_files (hotlist_id, account_id, url, file_name, uploaded_at)
select r.hotlist_id, r.account_id, r.url, r.file_name, r.uploaded_at from public.hotlist_resumes r
where not exists (select 1 from public.hotlist_resume_files f where f.hotlist_id = r.hotlist_id and f.url = r.url);

-- Upload: adds a resume; the first becomes the default. Returns its id.
drop function if exists public.set_hotlist_resume(uuid, text, text);
create function public.set_hotlist_resume(p_hotlist_id uuid, p_url text, p_file_name text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_account uuid;
  v_id uuid;
  v_name text := left(coalesce(nullif(trim(p_file_name), ''), 'resume.pdf'), 200);
begin
  select h.created_by_account_id into v_account
  from public.social_hotlist h
  where h.id = p_hotlist_id
    and h.created_by_account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active');
  if v_account is null then raise exception 'Not your consultant'; end if;
  if p_url is null or p_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/resumes/' then raise exception 'Invalid resume link'; end if;
  insert into public.hotlist_resume_files (hotlist_id, account_id, url, file_name)
  values (p_hotlist_id, v_account, p_url, v_name) returning id into v_id;
  insert into public.hotlist_resumes (hotlist_id, account_id, url, file_name, uploaded_at)
  values (p_hotlist_id, v_account, p_url, v_name, now())
  on conflict (hotlist_id) do nothing;
  return v_id;
end;
$$;
revoke all on function public.set_hotlist_resume(uuid, text, text) from public, anon;
grant execute on function public.set_hotlist_resume(uuid, text, text) to authenticated;

create or replace function public.set_default_hotlist_resume(p_file_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  f record;
begin
  select * into f from public.hotlist_resume_files
  where id = p_file_id and account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active');
  if f.id is null then raise exception 'Resume not found'; end if;
  insert into public.hotlist_resumes (hotlist_id, account_id, url, file_name, uploaded_at)
  values (f.hotlist_id, f.account_id, f.url, f.file_name, now())
  on conflict (hotlist_id) do update set url = excluded.url, file_name = excluded.file_name, uploaded_at = now();
end;
$$;
revoke all on function public.set_default_hotlist_resume(uuid) from public, anon;
grant execute on function public.set_default_hotlist_resume(uuid) to authenticated;

create or replace function public.delete_hotlist_resume_file(p_file_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  f record;
  n record;
begin
  select * into f from public.hotlist_resume_files
  where id = p_file_id and account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active');
  if f.id is null then return; end if;
  delete from public.hotlist_resume_files where id = f.id;
  if exists (select 1 from public.hotlist_resumes r where r.hotlist_id = f.hotlist_id and r.url = f.url) then
    select * into n from public.hotlist_resume_files where hotlist_id = f.hotlist_id order by uploaded_at desc limit 1;
    if n.id is null then
      delete from public.hotlist_resumes where hotlist_id = f.hotlist_id;
    else
      update public.hotlist_resumes set url = n.url, file_name = n.file_name, uploaded_at = now() where hotlist_id = f.hotlist_id;
    end if;
  end if;
end;
$$;
revoke all on function public.delete_hotlist_resume_file(uuid) from public, anon;
grant execute on function public.delete_hotlist_resume_file(uuid) to authenticated;

-- Removing "the resume" removes the default; the next newest takes its place.
create or replace function public.remove_hotlist_resume(p_hotlist_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_file uuid;
begin
  select f.id into v_file from public.hotlist_resume_files f
  join public.hotlist_resumes r on r.hotlist_id = f.hotlist_id and r.url = f.url
  where f.hotlist_id = p_hotlist_id
    and f.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active')
  limit 1;
  if v_file is not null then
    perform public.delete_hotlist_resume_file(v_file);
  else
    delete from public.hotlist_resumes r where r.hotlist_id = p_hotlist_id
      and r.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active');
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.get_submission_queue(p_per_subject integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account uuid;
  v_is_trial boolean;
  v_target integer;
  v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_result jsonb;
begin
  select am.account_id into v_account from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1;
  if v_account is null then return null; end if;
  select coalesce(a.is_trial, true), a.daily_submission_target into v_is_trial, v_target from public.accounts a where a.id = v_account;

  with subjects as (
    select h.id, h.role_title, h.candidate_name, h.visa_type, h.locations, h.years_experience, h.core_skills,
      h.hourly_rate_min, h.hourly_rate_max, coalesce(h.posted_at, h.created_at) as at,
      r.url as resume_url, r.file_name as resume_file_name
    from public.social_hotlist h
    left join public.hotlist_resumes r on r.hotlist_id = h.id
    where h.created_by_account_id = v_account and h.post_source = 'user_post'
      and coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null
  ),
  items as (
    select c.subject_id, c.id as card_id, j.id as job_id, j.job_title, j.posted_by_name, j.company_name, j.location,
      j.salary_range, j.extracted_hourly_rate_min, j.extracted_hourly_rate_max, j.post_source, j.post_url,
      coalesce(j.posted_at, j.created_at) as posted_at, c.similarity, c.fit_score,
      coalesce(btrim(j.poster_email), '') <> '' as has_email,
      -- Last 3 days first, then by match; C2C requirements older than
      -- 14 days are usually filled, so they are left out.
      row_number() over (partition by c.subject_id
        order by (coalesce(j.posted_at, j.created_at) > now() - interval '3 days') desc, c.similarity desc, coalesce(j.posted_at, j.created_at) desc) as rn
    from public.pipeline_cards c
    join subjects s on s.id = c.subject_id
    join public.social_jobs j on j.id = c.lead_id
    where c.account_id = v_account and c.subject_kind = 'hotlist' and c.stage = 'new'
      and j.hidden_at is null and coalesce(j.post_status, 'open') = 'open'
      and coalesce(j.posted_at, j.created_at) > now() - interval '14 days'
  )
  select jsonb_build_object(
    'target', v_target,
    'daily_cap', case when v_is_trial then 10 else 100 end,
    'used_today', (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.created_at >= v_day),
    'submitted_today',
      (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.created_at >= v_day
         and r.job_id is not null and r.status in ('completed', 'fulfilled'))
      + (select count(*) from public.external_applications a where a.account_id = v_account and a.created_at >= v_day),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'subject_id', s.id, 'role_title', s.role_title, 'candidate_name', s.candidate_name, 'visa_type', s.visa_type,
        'location', s.locations[1], 'years_experience', s.years_experience, 'skills', to_jsonb(s.core_skills[1:6]),
        'resume_url', s.resume_url, 'resume_file_name', s.resume_file_name,
        'resumes', coalesce((
          select jsonb_agg(jsonb_build_object('id', f.id, 'url', f.url, 'file_name', f.file_name, 'is_default', f.url = s.resume_url) order by f.uploaded_at desc)
          from public.hotlist_resume_files f where f.hotlist_id = s.id
        ), '[]'::jsonb),
        'submitted_today',
          (select count(*) from public.pulse_ask_ai_requests r where r.account_id = v_account and r.subject_hotlist_id = s.id
             and r.created_at >= v_day and r.status in ('completed', 'fulfilled'))
          + (select count(*) from public.external_applications a where a.account_id = v_account and a.subject_id = s.id and a.created_at >= v_day),
        'waiting', (select count(*) from items i where i.subject_id = s.id),
        'locked', (select count(*) from public.pipeline_waiting_matches w where w.subject_id = s.id),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'card_id', i.card_id, 'job_id', i.job_id, 'title', i.job_title, 'poster', i.posted_by_name, 'company', i.company_name,
            'location', i.location, 'pay', nullif(i.salary_range, ''), 'rate_min', i.extracted_hourly_rate_min, 'rate_max', i.extracted_hourly_rate_max,
            'source', i.post_source, 'apply_url', case when i.post_source = 'career_site' then i.post_url end,
            'posted_at', i.posted_at, 'similarity', round(i.similarity::numeric, 3), 'fit', coalesce(i.fit_score, round(i.similarity * 100)::int), 'has_email', i.has_email,
            'duplicate', public.submission_duplicate(v_account, s.id, i.job_id)
          ) order by i.rn)
          from items i where i.subject_id = s.id and i.rn <= p_per_subject
        ), '[]'::jsonb)
      ) order by s.at desc)
      from subjects s
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;
