-- invite_consultant_to_screening failed with:
--   column reference "screening_token" is ambiguous
--
-- The function declares screening_token, candidate_name and candidate_email as
-- OUT parameters in RETURNS TABLE, and then selects columns of the same names
-- from job_applications. Inside a plpgsql body an unqualified name matches the
-- OUT parameter as readily as the column, so the lookup for an existing
-- invitation could not be planned at all — and the whole call raised, which
-- the UI saw as "no link".
--
-- Every column reference is now table-qualified. The OUT parameters keep their
-- names because callers read them by name.

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
  v_existing_token text;
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

  -- Qualified: ja.screening_token, not screening_token, which would also
  -- match the OUT parameter of the same name.
  select ja.screening_token into v_existing_token
  from public.job_applications ja
  where ja.social_job_id = p_social_job_id
    and lower(btrim(coalesce(ja.candidate_email, ''))) = v_email
  limit 1;

  if v_existing_token is not null then
    return query select v_existing_token, v_name, v_email;
    return;
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  insert into public.job_applications (
    social_job_id, candidate_name, candidate_email,
    status, screening_token, created_by_account_id, created_by_user_id
  )
  values (
    p_social_job_id, v_name, v_email,
    'screening_sent', v_token, v_account_id, auth.uid()
  );

  return query select v_token, v_name, v_email;
end;
$$;

revoke all on function public.invite_consultant_to_screening(uuid, uuid) from public, anon;
grant execute on function public.invite_consultant_to_screening(uuid, uuid) to authenticated;
