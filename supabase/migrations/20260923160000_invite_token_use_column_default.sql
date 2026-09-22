-- invite_consultant_to_screening failed with:
--   function gen_random_bytes(integer) does not exist
--
-- gen_random_bytes comes from pgcrypto, which Supabase installs into the
-- extensions schema. The function sets search_path = public, so the name does
-- not resolve. Schema-qualifying it would work, but there is a better answer:
-- job_applications.screening_token already has a default that every other
-- application row in the system is created with —
--
--   replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
--
-- so the insert now omits the column and reads back what the default
-- generated. One way of minting a token instead of two, and no dependency on
-- an extension's search path.

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
  v_email text;
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
  into v_name, v_email
  from public.social_hotlist h
  where h.id = p_hotlist_id and h.hidden_at is null;

  if v_email is null or v_email = '' then
    raise exception 'this consultant has no contact address to invite';
  end if;

  -- Qualified everywhere: these names are also OUT parameters of this
  -- function, and an unqualified reference matches those first.
  select ja.screening_token into v_token
  from public.job_applications ja
  where ja.social_job_id = p_social_job_id
    and lower(btrim(coalesce(ja.candidate_email, ''))) = v_email
  limit 1;

  if v_token is not null then
    return query select v_token, v_name, v_email;
    return;
  end if;

  insert into public.job_applications (
    social_job_id, candidate_name, candidate_email,
    status, created_by_account_id, created_by_user_id
  )
  values (
    p_social_job_id, v_name, v_email,
    'screening_sent', v_account_id, auth.uid()
  )
  returning job_applications.screening_token into v_token;

  return query select v_token, v_name, v_email;
end;
$$;

revoke all on function public.invite_consultant_to_screening(uuid, uuid) from public, anon;
grant execute on function public.invite_consultant_to_screening(uuid, uuid) to authenticated;
