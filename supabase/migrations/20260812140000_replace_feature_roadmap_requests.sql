do $$
declare
  v_owner_id uuid;
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
    raise exception 'Cannot seed feature requests without an auth user';
  end if;

  delete from public.feature_requests;

  insert into public.feature_requests (
    user_id,
    title,
    description,
    vote_count,
    created_at
  )
  values
    (
      v_owner_id,
      'Pin Search Histories',
      'Add an option to pin search histories for easy and quick access to frequently used filters.',
      1,
      now()
    ),
    (
      v_owner_id,
      'Search History Match Notifications',
      'Send notifications when new matches are found for saved search history.',
      1,
      now() + interval '1 millisecond'
    ),
    (
      v_owner_id,
      'Bulk Email Vendors',
      'Allow bulk emailing of vendors from the Vendors list.',
      1,
      now() + interval '2 milliseconds'
    ),
    (
      v_owner_id,
      'Post Live Requirements',
      'Add an option to post live requirements directly in the portal.',
      1,
      now() + interval '3 milliseconds'
    ),
    (
      v_owner_id,
      'Post Live Hotlist',
      'Add an option to post a live Hotlist directly in the portal.',
      1,
      now() + interval '4 milliseconds'
    ),
    (
      v_owner_id,
      'Report Generation',
      'Create daily, weekly, monthly, and quarterly reports for individual or team activities.',
      1,
      now() + interval '5 milliseconds'
    ),
    (
      v_owner_id,
      'Reveal Phone Numbers',
      'Add an option for revealing phone numbers.',
      1,
      now() + interval '6 milliseconds'
    );

  insert into public.feature_request_votes (request_id, user_id)
  select request.id, v_owner_id
  from public.feature_requests request;
end;
$$;
