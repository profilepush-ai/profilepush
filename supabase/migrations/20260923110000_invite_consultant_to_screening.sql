-- A vendor inviting a consultant to an AI video screening.
--
-- The screening flow already exists and is keyed on
-- job_applications.screening_token, but every path into it runs the other way:
-- a bench sales user submits a candidate to a vendor's job, and the vendor
-- then screens them. After AI Match a vendor is looking at consultants who
-- have not applied to anything, so there is no application row and therefore
-- no link to send.
--
-- This mints one. It is the same object the existing worker already reads, so
-- /screen/:token, the question generation, the recording and the review all
-- work unchanged — only the way the row comes into existence is new.
--
-- The job must be one the caller owns. Without that check a vendor could mint
-- screening links against somebody else's requirement and collect video
-- interviews under their name.

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
  v_existing record;
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
    raise exception 'job not found or not yours';
  end if;

  select
    coalesce(nullif(btrim(h.role_title), ''), 'Consultant'),
    lower(btrim(coalesce(h.bench_sales_recruiter_email, '')))
  into v_name, v_email
  from public.social_hotlist h
  where h.id = p_hotlist_id and h.hidden_at is null;

  if v_email is null or v_email = '' then
    raise exception 'consultant has no contact address';
  end if;

  -- One standing invitation per job and consultant. Re-inviting reuses the
  -- same link, so a consultant who was sent it twice does not end up with two
  -- half-finished screenings for the same role.
  select id, screening_token into v_existing
  from public.job_applications
  where social_job_id = p_social_job_id
    and lower(btrim(coalesce(candidate_email, ''))) = v_email
  limit 1;

  if v_existing.id is not null then
    return query select v_existing.screening_token::text, v_name, v_email;
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
