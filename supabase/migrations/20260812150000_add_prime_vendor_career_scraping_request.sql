do $$
declare
  v_owner_id uuid;
  v_request_id uuid;
begin
  select request_owner.user_id
  into v_owner_id
  from public.feature_requests request_owner
  order by request_owner.created_at
  limit 1;

  if v_owner_id is null then
    select account.id
    into v_owner_id
    from auth.users account
    order by account.created_at
    limit 1;
  end if;

  if v_owner_id is null then
    raise exception 'Cannot seed feature request without an auth user';
  end if;

  insert into public.feature_requests (
    user_id,
    title,
    description,
    vote_count
  )
  values (
    v_owner_id,
    'Prime Vendor Career Page Job Scraping',
    'Add job scraping from prime vendors'' career pages and ingest those jobs into the platform.',
    1
  )
  returning id into v_request_id;

  insert into public.feature_request_votes (request_id, user_id)
  values (v_request_id, v_owner_id);
end;
$$;
