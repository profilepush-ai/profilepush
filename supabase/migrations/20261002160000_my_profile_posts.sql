-- My Profile: every post that is the signed-in account's, open or closed.
--
-- "Theirs" means either posted in ProfilePush (post_source 'user_post',
-- created by their account) or any post carrying the email of a profile
-- they've claimed. Requirements are grouped by dedup_key (the same
-- requirement shared in several places is one post); hotlists by their
-- source post (one post, several consultants). match_text is what AI Match
-- is seeded with.
--
-- set_my_post_status opens or closes one of those posts. For an imported
-- post it closes every copy carrying their email (same dedup_key for a
-- requirement, same source post for a hotlist).

create or replace function public.get_my_all_posts()
returns table (
  kind text,
  id uuid,
  is_own_post boolean,
  post_status text,
  posted_at timestamptz,
  title text,
  location text,
  rate_min numeric,
  rate_max numeric,
  roles text[],
  consultant_count integer,
  match_text text,
  copies integer
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.publisher_account_for_user(auth.uid()) as account_id),
  emails as (
    select p.email from public.publisher_profiles p, me
    where p.claimed_account_id = me.account_id and p.removed_at is null
  ),
  jobs as (
    select j.*, (j.post_source = 'user_post' and j.created_by_account_id = me.account_id) as own
    from public.social_jobs j, me
    where j.hidden_at is null
      and (
        (j.post_source = 'user_post' and j.created_by_account_id = me.account_id)
        or (coalesce(j.poster_email, '') <> '' and public.publisher_email_key(j.poster_email) in (select email from emails))
      )
  ),
  job_groups as (
    select distinct on (coalesce(nullif(j.dedup_key, ''), j.id::text))
      'job'::text as kind, j.id, j.own, coalesce(j.post_status, 'open') as post_status,
      coalesce(j.posted_at, j.created_at) as posted_at,
      coalesce(nullif(trim(j.job_title), ''), nullif(trim(j.extracted_role_normalized), ''), 'Requirement') as title,
      nullif(trim(j.location), '') as location,
      j.extracted_hourly_rate_min as rate_min, j.extracted_hourly_rate_max as rate_max,
      '{}'::text[] as roles, null::integer as consultant_count,
      coalesce(
        case when length(trim(coalesce(j.post_content, ''))) >= 40 then trim(j.post_content) end,
        case when length(trim(coalesce(j.job_description, ''))) >= 40 then trim(j.job_description) end,
        concat_ws(' · ', j.job_title, j.location, (select string_agg(value, ', ') from jsonb_array_elements_text(case when jsonb_typeof(j.extracted_skills) = 'array' then j.extracted_skills else '[]'::jsonb end)), nullif(trim(j.employment_type), ''))
      ) as match_text,
      (select count(*)::integer from jobs j2 where coalesce(nullif(j2.dedup_key, ''), j2.id::text) = coalesce(nullif(j.dedup_key, ''), j.id::text)) as copies
    from jobs j
    order by coalesce(nullif(j.dedup_key, ''), j.id::text), coalesce(j.posted_at, j.created_at) desc
  ),
  hot as (
    select h.*, (h.post_source = 'user_post' and h.created_by_account_id = me.account_id) as own,
      coalesce(h.source_post_id::text, h.id::text) as grp
    from public.social_hotlist h, me
    where h.hidden_at is null
      and (
        (h.post_source = 'user_post' and h.created_by_account_id = me.account_id)
        or (coalesce(h.bench_sales_recruiter_email, '') <> '' and public.publisher_email_key(h.bench_sales_recruiter_email) in (select email from emails))
      )
  ),
  hot_groups as (
    select 'hotlist'::text as kind,
      (array_agg(h.id order by h.candidate_index nulls last, h.created_at))[1] as id,
      bool_or(h.own) as own,
      case when bool_or(coalesce(h.post_status, 'open') = 'open') then 'open' else 'closed' end as post_status,
      max(coalesce(h.posted_at, h.created_at)) as posted_at,
      null::text as title,
      nullif(array_to_string((array_agg(distinct l) filter (where l is not null))[1:3], ', '), '') as location,
      min(h.hourly_rate_min) as rate_min, max(h.hourly_rate_max) as rate_max,
      (array_agg(distinct nullif(trim(h.role_title), '')) filter (where nullif(trim(h.role_title), '') is not null))[1:8] as roles,
      count(*)::integer as consultant_count,
      -- The original post when there is one, else each consultant spelled
      -- out (role, skills, experience, visa, location, summary): a role on
      -- its own is too short for AI Match.
      coalesce(
        max(case when length(trim(coalesce(h.raw_post_content, ''))) >= 40 then trim(h.raw_post_content) end),
        string_agg(distinct concat_ws(' · ',
          nullif(trim(h.role_title), ''),
          nullif('Skills: ' || array_to_string(h.core_skills, ', '), 'Skills: '),
          case when h.years_experience is not null then h.years_experience || ' years' end,
          nullif(trim(h.visa_type), ''),
          nullif(array_to_string(h.locations, ', '), ''),
          nullif(trim(h.candidate_summary), '')
        ), E'\n')
      ) as match_text,
      1 as copies
    from hot h
    left join lateral unnest(h.locations) l on true
    group by h.grp
  )
  select kind, id, own, post_status, posted_at, title, location, rate_min, rate_max, roles, consultant_count, match_text, copies
  from (select * from job_groups union all select * from hot_groups) t
  order by posted_at desc
  limit 400;
$$;

create or replace function public.set_my_post_status(p_kind text, p_id uuid, p_status text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_count integer := 0;
  v_job public.social_jobs%rowtype;
  v_hot public.social_hotlist%rowtype;
begin
  if v_account is null then raise exception 'Sign in first'; end if;
  if p_status not in ('open', 'closed') then raise exception 'Status must be open or closed'; end if;

  if p_kind = 'job' then
    select * into v_job from public.social_jobs where id = p_id and hidden_at is null;
    if not found then raise exception 'Post not found'; end if;
    if v_job.post_source = 'user_post' and v_job.created_by_account_id = v_account then
      update public.social_jobs set post_status = p_status, updated_at = now() where id = p_id;
      get diagnostics v_count = row_count;
    elsif exists (
      select 1 from public.publisher_profiles p
      where p.claimed_account_id = v_account and p.removed_at is null
        and p.email = public.publisher_email_key(v_job.poster_email)
    ) then
      update public.social_jobs j set post_status = p_status, updated_at = now()
      where j.hidden_at is null
        and public.publisher_email_key(j.poster_email) = public.publisher_email_key(v_job.poster_email)
        and coalesce(nullif(j.dedup_key, ''), j.id::text) = coalesce(nullif(v_job.dedup_key, ''), v_job.id::text);
      get diagnostics v_count = row_count;
    else
      raise exception 'This post isn''t yours';
    end if;
  elsif p_kind = 'hotlist' then
    select * into v_hot from public.social_hotlist where id = p_id and hidden_at is null;
    if not found then raise exception 'Post not found'; end if;
    if (v_hot.post_source = 'user_post' and v_hot.created_by_account_id = v_account)
       or exists (
         select 1 from public.publisher_profiles p
         where p.claimed_account_id = v_account and p.removed_at is null
           and p.email = public.publisher_email_key(v_hot.bench_sales_recruiter_email)
       ) then
      update public.social_hotlist h set post_status = p_status, updated_at = now()
      where h.hidden_at is null
        and coalesce(h.source_post_id::text, h.id::text) = coalesce(v_hot.source_post_id::text, v_hot.id::text)
        and (
          (h.post_source = 'user_post' and h.created_by_account_id = v_account)
          or public.publisher_email_key(h.bench_sales_recruiter_email) = public.publisher_email_key(v_hot.bench_sales_recruiter_email)
        );
      get diagnostics v_count = row_count;
    else
      raise exception 'This post isn''t yours';
    end if;
  else
    raise exception 'Unknown post kind';
  end if;
  return v_count;
end;
$$;

revoke all on function public.get_my_all_posts() from public, anon;
revoke all on function public.set_my_post_status(text, uuid, text) from public, anon;
grant execute on function public.get_my_all_posts() to authenticated;
grant execute on function public.set_my_post_status(text, uuid, text) to authenticated;
