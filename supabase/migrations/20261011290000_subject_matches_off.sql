/*
# Matches on or off for each profile or job

The account-wide AI Matches switch stays; this adds one per profile (or job).
While a profile's matches are off, no new matches are added for it (the
matchers, waiting matches released by a top-up, AI Match runs); what's already
in Today and the Tracker stays. Turning it back on brings new matches again.

- pipeline_subject_settings.matches_off
- set_subject_matches(subject, on): the owner's switch
- get_match_caps() gives each profile's 'on' with its daily cap
*/

alter table public.pipeline_subject_settings add column if not exists matches_off boolean not null default false;

-- No new cards for a profile whose matches are off.
do $$
declare
  v_src text := pg_get_functiondef('public.charge_tracker_match()'::regprocedure);
  v_anchor text := $a$  if exists (select 1 from public.pipeline_cards c where c.subject_id = new.subject_id and c.lead_id = new.lead_id) then
    return null;
  end if;$a$;
begin
  if position(v_anchor in v_src) = 0 then raise exception 'charge_tracker_match: anchor not found'; end if;
  execute replace(v_src, v_anchor, v_anchor || $b$
  -- Matches switched off for this profile (or job): nothing new for it.
  if exists (select 1 from public.pipeline_subject_settings s where s.subject_id = new.subject_id and s.matches_off) then
    return null;
  end if;$b$);
end $$;

-- Each profile's switch alongside its daily cap.
do $$
declare
  v_src text := pg_get_functiondef('public.get_match_caps()'::regprocedure);
  v_anchor text := $a$'cap', public.pp_daily_match_cap(acct.account_id, s.id),$a$;
begin
  if position(v_anchor in v_src) = 0 then raise exception 'get_match_caps: anchor not found'; end if;
  execute replace(v_src, v_anchor, v_anchor || $b$
        'on', not coalesce((select ps.matches_off from public.pipeline_subject_settings ps where ps.subject_id = s.id), false),$b$);
end $$;

create or replace function public.set_subject_matches(p_subject_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_account uuid;
begin
  select am.account_id into v_account from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1;
  if v_account is null then return jsonb_build_object('error', 'no_account'); end if;
  if not exists (select 1 from public.social_hotlist h where h.id = p_subject_id and h.created_by_account_id = v_account)
     and not exists (select 1 from public.social_jobs j where j.id = p_subject_id and j.created_by_account_id = v_account) then
    return jsonb_build_object('error', 'not_your_post');
  end if;
  insert into public.pipeline_subject_settings (subject_id, account_id, daily_match_cap, matches_off, updated_at)
  values (p_subject_id, v_account, 30, not p_on, now())
  on conflict (subject_id) do update set matches_off = not p_on, updated_at = now();
  return jsonb_build_object('ok', true, 'on', p_on);
end;
$$;
revoke all on function public.set_subject_matches(uuid, boolean) from public, anon;
grant execute on function public.set_subject_matches(uuid, boolean) to authenticated;
