-- Two things wrong with how an invitation was recorded.
--
-- 1. It deduped on candidate_email, which is not the candidate's address.
--
-- A hotlist post carries bench_sales_recruiter_email: the recruiter who posted
-- the consultant, not the consultant. That is the right person to email — you
-- are asking them to put their consultant through a screening — but it is the
-- same address for every consultant that recruiter posts. Deduping on it meant
-- the second consultant from a given recruiter returned the FIRST one's
-- screening link, so two different people would have been interviewed under
-- one record.
--
-- The invitation is now keyed on which consultant it is for.
--
-- 2. candidate_name held the role title.
--
-- A hotlist row has role_title ("Senior React Developer"), not a person's
-- name, so that is what the screening page greeted them with. It is kept,
-- because it is the only label there is, but the recruiter's address now goes
-- in recruiter_note rather than masquerading as the candidate's.

alter table public.job_applications
  add column if not exists source_hotlist_id uuid references public.social_hotlist(id) on delete set null;

create unique index if not exists job_applications_job_hotlist_uniq
  on public.job_applications (social_job_id, source_hotlist_id)
  where source_hotlist_id is not null;

create or replace function public.invite_consultant_to_screening(
  p_social_job_id uuid,
  p_hotlist_id uuid
)
returns table (screening_token text, candidate_name text, candidate_email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_owns_job boolean;
  v_name text;
  v_recruiter_email text;
  v_token text;
begin
  select am.account_id into v_account_id
  from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active'
  order by am.created_at asc
  limit 1;

  if v_account_id is null then
    raise exception 'no active account';
  end if;

  select exists (
    select 1 from public.social_jobs j
    where j.id = p_social_job_id
      and j.created_by_account_id = v_account_id
      and j.hidden_at is null
  ) into v_owns_job;

  if not v_owns_job then
    raise exception 'that job is not yours, or is no longer live';
  end if;

  select
    coalesce(nullif(btrim(h.role_title), ''), 'Consultant'),
    lower(btrim(coalesce(h.bench_sales_recruiter_email, '')))
  into v_name, v_recruiter_email
  from public.social_hotlist h
  where h.id = p_hotlist_id and h.hidden_at is null;

  if v_recruiter_email is null or v_recruiter_email = '' then
    raise exception 'this consultant has no contact address to invite';
  end if;

  -- Keyed on the consultant, not on the address. One recruiter posting five
  -- consultants gets five invitations, not one reused five times.
  select ja.screening_token into v_token
  from public.job_applications ja
  where ja.social_job_id = p_social_job_id
    and ja.source_hotlist_id = p_hotlist_id
  limit 1;

  if v_token is not null then
    return query select v_token, v_name, v_recruiter_email;
    return;
  end if;

  insert into public.job_applications (
    social_job_id, source_hotlist_id, candidate_name, candidate_email,
    recruiter_note, status, created_by_account_id, created_by_user_id
  )
  values (
    p_social_job_id, p_hotlist_id, v_name, '',
    'Invited via AI Match. Sent to the bench sales recruiter ' || v_recruiter_email,
    'screening_sent', v_account_id, auth.uid()
  )
  returning job_applications.screening_token into v_token;

  return query select v_token, v_name, v_recruiter_email;
end;
$$;

revoke all on function public.invite_consultant_to_screening(uuid, uuid) from public, anon;
grant execute on function public.invite_consultant_to_screening(uuid, uuid) to authenticated;
