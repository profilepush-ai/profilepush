/*
# AI Match results land in Today

After an AI Match run the page sends its results here; they become Today
matches for the profile (or job) the run saved from what was pasted, so the
user swipes them in Today like any other match, and applies, saves or passes
on them there.

- The subject: the account's own post with exactly that text (the run stores
  it trimmed and cut at 7,900 characters), else its newest own post of that
  kind from the last 15 minutes (a pasted bench saves one post per
  consultant).
- The run already charged for these matches, so each one is recorded against
  that subject first; the card charge trigger then adds them free.
- A match already on that subject's list and still new comes back to the top
  of Today.

Returns { subject_id, subject_kind, added } (subject_id null when the run
saved nothing, e.g. a sample run or a free account's post limit).
*/

create or replace function public.ai_match_to_today(p_target text, p_description text, p_results jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_acct uuid := public.publisher_account_for_user(auth.uid());
  v_content text := regexp_replace(left(coalesce(p_description, ''), 7900), '^\s+|\s+$', '', 'g');
  v_subject_kind text := case when p_target = 'jobs' then 'hotlist' else 'job' end;
  v_lead_kind text := case when p_target = 'jobs' then 'job' else 'hotlist' end;
  v_subject uuid;
  v_added integer := 0;
begin
  if v_acct is null or p_target not in ('jobs', 'hotlists') then return jsonb_build_object('subject_id', null); end if;

  if v_subject_kind = 'hotlist' then
    select h.id into v_subject from public.social_hotlist h
    where h.created_by_account_id = v_acct and h.post_source = 'user_post' and h.raw_post_content = v_content
    order by h.created_at desc limit 1;
    if v_subject is null then
      select h.id into v_subject from public.social_hotlist h
      where h.created_by_account_id = v_acct and h.post_source = 'user_post' and h.created_at > now() - interval '15 minutes'
      order by h.created_at desc limit 1;
    end if;
  else
    select j.id into v_subject from public.social_jobs j
    where j.created_by_account_id = v_acct and j.post_source = 'user_post' and j.post_content = v_content
    order by j.created_at desc limit 1;
    if v_subject is null then
      select j.id into v_subject from public.social_jobs j
      where j.created_by_account_id = v_acct and j.post_source = 'user_post' and j.created_at > now() - interval '15 minutes'
      order by j.created_at desc limit 1;
    end if;
  end if;
  if v_subject is null then return jsonb_build_object('subject_id', null); end if;

  with r as (
    select distinct on ((e->>'lead_id')::uuid) (e->>'lead_id')::uuid as lead_id,
      least(100, greatest(0, round(coalesce((e->>'ai_score')::numeric, 0))))::integer as fit,
      coalesce((e->>'similarity')::double precision, 0) as sim
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e
    where e ? 'lead_id' and (e->>'lead_id') ~ '^[0-9a-f-]{36}$'
    limit 200
  ), charged as (
    -- Paid by the run: recorded against this subject, so the cards are free.
    insert into public.match_charges (account_id, subject_id, lead_id, source)
    select v_acct, v_subject, r.lead_id, 'ai_match' from r
    where not exists (select 1 from public.match_charges m where m.account_id = v_acct and m.subject_id = v_subject and m.lead_id = r.lead_id)
    returning 1
  )
  select count(*) into v_added from charged;

  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity, fit_score)
  select v_acct, v_subject_kind, v_subject, v_lead_kind, r.lead_id, r.sim, r.fit
  from (
    select distinct on ((e->>'lead_id')::uuid) (e->>'lead_id')::uuid as lead_id,
      least(100, greatest(0, round(coalesce((e->>'ai_score')::numeric, 0))))::integer as fit,
      coalesce((e->>'similarity')::double precision, 0) as sim
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e
    where e ? 'lead_id' and (e->>'lead_id') ~ '^[0-9a-f-]{36}$'
    limit 200
  ) r
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;

  -- Already on the list and still new: back to the top of Today.
  update public.pipeline_cards c set added_at = now()
  where c.subject_id = v_subject and c.stage = 'new' and c.saved_at is null
    and c.lead_id in (select (e->>'lead_id')::uuid from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) e
                      where (e->>'lead_id') ~ '^[0-9a-f-]{36}$')
    and c.added_at < now() - interval '1 minute';

  return jsonb_build_object('subject_id', v_subject, 'subject_kind', v_subject_kind, 'added', v_added);
end;
$$;
revoke all on function public.ai_match_to_today(text, text, jsonb) from public, anon;
grant execute on function public.ai_match_to_today(text, text, jsonb) to authenticated;
