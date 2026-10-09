/*
# Tracker matches must be submittable, not just similar

The Tracker matched on embedding similarity alone, then topped up any column
with fewer than 5 cards with matches down to 0.50. So it showed H1B
consultants requirements that say "USC/GC only" or "No H1B", consultants in
another state for "locals only" roles, India recruiter jobs and non-IT posts,
and weak matches that looked like strong ones.

1. Rule helpers (pp_*): work-authorization codes and US states from text, and
   lead / pair checks. They only rule a match out when the post states
   something that conflicts; anything unknown passes.
   - Requirement leads: not a known non-US post, not Non-IT, not a job for a
     recruiter/HR/sales person, not a clearly non-US location.
   - Consultant leads: same, plus junk "roles" such as "GC" or "Sales Recruiters".
   - Pairs: AI Match's visa rule (USC/GC fit anywhere; otherwise the stated
     authorizations must overlap) plus "No H1B", "USC/GC only" and "locals only"
     read from the post text.
2. refresh_pipeline_cards and rematch_pipeline_subject apply these rules.
3. The weak top-up is gone: run_pipeline_matcher no longer calls
   fill_sparse_pipeline_columns, which now just runs the main matcher.
4. Untouched "new" cards that fail the rules or sit below 0.70 are removed
   (owner decision: no credit refunds). Cards a user has acted on are kept.
*/

-- Work-authorization codes mentioned in a piece of text (same aliases as AI Match).
create or replace function public.pp_visa_codes(p_text text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(code), '{}') from (
    select 'usc' as code where p_text ~* '\musc\M|citizen'
    union all select 'gc' where p_text ~* 'green.?card|\mgc\M|permanent resident'
    union all select 'h1b' where p_text ~* 'h1|h-1'
    union all select 'ead' where p_text ~* '\mead\M'
    union all select 'opt' where p_text ~* '\mopt\M'
    union all select 'cpt' where p_text ~* '\mcpt\M'
    union all select 'tn' where p_text ~* '\mtn\M'
  ) c;
$$;

-- US state codes named in a piece of text ("Dallas, TX", "Texas").
create or replace function public.pp_us_states(p_text text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct s.code), '{}')
  from (values
    ('AL','alabama'),('AK','alaska'),('AZ','arizona'),('AR','arkansas'),('CA','california'),('CO','colorado'),
    ('CT','connecticut'),('DE','delaware'),('DC','district of columbia'),('FL','florida'),('GA','georgia'),
    ('HI','hawaii'),('ID','idaho'),('IL','illinois'),('IN','indiana'),('IA','iowa'),('KS','kansas'),
    ('KY','kentucky'),('LA','louisiana'),('ME','maine'),('MD','maryland'),('MA','massachusetts'),
    ('MI','michigan'),('MN','minnesota'),('MS','mississippi'),('MO','missouri'),('MT','montana'),
    ('NE','nebraska'),('NV','nevada'),('NH','new hampshire'),('NJ','new jersey'),('NM','new mexico'),
    ('NY','new york'),('NC','north carolina'),('ND','north dakota'),('OH','ohio'),('OK','oklahoma'),
    ('OR','oregon'),('PA','pennsylvania'),('RI','rhode island'),('SC','south carolina'),('SD','south dakota'),
    ('TN','tennessee'),('TX','texas'),('UT','utah'),('VT','vermont'),('VA','virginia'),('WA','washington'),
    ('WV','west virginia'),('WI','wisconsin'),('WY','wyoming')
  ) as s(code, name)
  where coalesce(p_text, '') ~ ('\m' || s.code || '\M') or coalesce(p_text, '') ~* ('\m' || s.name || '\M');
$$;

-- Job titles that are jobs FOR recruiters/sales/HR, not client requirements.
create or replace function public.pp_is_recruiter_role(p_title text)
returns boolean language sql immutable as $$
  select coalesce(p_title, '') ~* '(recruiter|recruiting|bench\s*sales|talent\s+acquisition|\msourcer\M|sourcing\s+(specialist|executive|lead)|\mhr\s+(executive|generalist|manager|recruiter|intern)|human\s+resources|business\s+development\s+(executive|associate|manager)|\mbde\M|lead\s+generation|inside\s+sales)';
$$;

-- A location that is clearly outside the US (used where country isn't known).
create or replace function public.pp_is_non_us_place(p_text text)
returns boolean language sql immutable as $$
  select coalesce(p_text, '') ~* '(india|hyderabad|bengaluru|bangalore|chennai|pune|noida|gurgaon|gurugram|mumbai|kolkata|ahmedabad|kochi|trivandrum|tamil nadu|andhra|telangana|karnataka|kerala|nigeria|lagos|pakistan|karachi|lahore|philippines|manila|hong kong|dubai|\muae\M|saudi|riyadh|qatar|doha|singapore|london|united kingdom|toronto|canada|sydney|melbourne|australia)'
     and coalesce(p_text, '') !~* '(\musa?\M|united states|remote)'
     and coalesce(p_text, '') !~ ',\s*[A-Z]{2}\M';
$$;

-- Is this requirement worth showing to a US IT staffing user at all?
create or replace function public.pp_job_lead_ok(p_country text, p_category text, p_title text, p_location text)
returns boolean language sql immutable as $$
  select not (
       (p_country is not null and p_country <> 'US')
    or coalesce(p_category, '') = 'Non-IT'
    or public.pp_is_recruiter_role(p_title)
    or (p_country is null and public.pp_is_non_us_place(p_location))
  );
$$;

-- Is this consultant a real, US-market IT consultant?
create or replace function public.pp_hotlist_lead_ok(p_country text, p_category text, p_role text, p_locations text[])
returns boolean language sql immutable as $$
  select not (
       (p_country is not null and p_country <> 'US')
    or coalesce(p_category, '') = 'Non-IT'
    or public.pp_is_recruiter_role(p_role)
    or coalesce(p_role, '') ~* '^\s*(gc|usc|h1b?|h-1b|opt|cpt|ead|c2c|w2|it|it consultant|consultant|c2c consultant|sales recruiters?)s?\s*$'
    or (p_country is null and public.pp_is_non_us_place(array_to_string(p_locations, ', ')))
  );
$$;

-- Can this consultant actually be submitted to this requirement? Only says no
-- when both sides state something that rules it out; unknown never blocks.
create or replace function public.pp_pair_ok(
  p_job_visas jsonb, p_job_text text, p_job_location text,
  p_person_visa text, p_person_locations text[], p_person_text text
) returns boolean language plpgsql immutable as $$
declare
  jv text[] := public.pp_visa_codes(coalesce(p_job_visas::text, ''));
  pv text[] := public.pp_visa_codes(coalesce(p_person_visa, ''));
  jt text := coalesce(p_job_text, '');
  unrestricted boolean;
  excluded text[] := '{}';
  js text[]; ps text[];
begin
  if cardinality(pv) > 0 then
    unrestricted := pv && array['usc', 'gc'];
    if not unrestricted then
      -- "USC/GC only", "US citizens only", "GC holders only"
      -- "USC/GC only" in the text is trusted only when the post's own visa list
      -- doesn't say otherwise ("Only USC/GC/H4-EAD", "H1B and US Citizens Only").
      if (cardinality(jv) = 0 or jv <@ array['usc', 'gc'])
         and (jt ~* '\m(usc|us\s+citizens?|citizens?|gc|green\s*card)\M[^.\n]{0,25}\monly\M'
              or jt ~* '\monly\W{0,3}(usc|us\s+citizens?|gc|green\s*card)\M') then return false; end if;
      if jt ~* '\mno\W{0,3}(h1b?|h-1b?)' or jt ~* '\mno\W{0,3}sponsorship' then excluded := array_append(excluded, 'h1b'); end if;
      if jt ~* '\mno\s+opt\M' then excluded := array_append(excluded, 'opt'); end if;
      if jt ~* '\mno\s+cpt\M' then excluded := array_append(excluded, 'cpt'); end if;
      if pv <@ excluded then return false; end if;
      -- "No H1B" sometimes lands in the extracted list as if it were accepted.
      jv := array(select unnest(jv) except select unnest(excluded));
      -- Both sides state work authorization and nothing overlaps (OPT counts as EAD).
      if cardinality(jv) > 0
         and not (pv && jv)
         and not ('opt' = any(pv) and 'ead' = any(jv)) then
        return false;
      end if;
    end if;
  end if;

  -- "Locals only": the consultant's stated state(s) must include the job's.
  if jt ~* '\m(locals?\s+only|only\s+locals?|local\s+(candidates?|consultants?|profiles?)\s+only|must\s+be\s+local|need\s+locals?)\M' then
    js := public.pp_us_states(p_job_location);
    ps := public.pp_us_states(array_to_string(p_person_locations, ', '));
    if cardinality(js) > 0 and cardinality(ps) > 0 and not (js && ps)
       and coalesce(p_person_text, '') !~* 'relocat|anywhere' then
      return false;
    end if;
  end if;
  return true;
end;
$$;

create or replace function public.refresh_pipeline_cards(p_lead_window interval DEFAULT '36:00:00'::interval, p_new_subjects_since timestamp with time zone DEFAULT (now() - '01:00:00'::interval), p_backfill_window interval DEFAULT '7 days'::interval)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_count integer := 0;
  v_added integer;
begin
  -- Consultants -> requirements.
  with subjects as (
    select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb,
      h.visa_type, h.locations, h.candidate_summary,
      case when h.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_hotlist h
    where h.post_source = 'user_post' and h.post_status = 'open' and h.hidden_at is null
      and h.created_by_account_id is not null and h.hotlist_embedding is not null
  ),
  leads as (
    select j.id, j.job_embedding as emb, coalesce(j.posted_at, j.created_at) as at, j.created_by_account_id,
      j.extracted_visa_types, j.post_content, j.location
    from public.social_jobs j
    where j.hidden_at is null and j.job_embedding is not null
      and coalesce(j.post_status, 'open') = 'open'
      and coalesce(j.posted_at, j.created_at) >= now() - p_backfill_window
      and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
      and public.pp_job_lead_ok(j.country, j.job_category, j.job_title, j.location)
  ),
  pairs as (
    select s.account_id, s.id as subject_id, l.id as lead_id, (1 - (s.emb <=> l.emb))::real as sim,
      l.extracted_visa_types, l.post_content, l.location, s.visa_type, s.locations, s.candidate_summary
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
  ),
  ranked as (
    select p.account_id, p.subject_id, p.lead_id, p.sim,
      row_number() over (partition by p.subject_id order by p.sim desc) as rn
    from pairs p
    where p.sim >= 0.70
      and not exists (select 1 from public.pipeline_cards c where c.subject_id = p.subject_id and c.lead_id = p.lead_id)
      and public.pp_pair_ok(p.extracted_visa_types, p.post_content, p.location, p.visa_type, p.locations, p.candidate_summary)
  )
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
  select account_id, 'hotlist', subject_id, 'job', lead_id, sim from ranked where rn <= 15
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  -- Requirements -> consultants.
  with subjects as (
    select j.id, j.created_by_account_id as account_id, j.job_embedding as emb,
      j.extracted_visa_types, j.post_content, j.location,
      case when j.created_at >= p_new_subjects_since then p_backfill_window else p_lead_window end as win
    from public.social_jobs j
    where j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
      and j.created_by_account_id is not null and j.job_embedding is not null
  ),
  leads as (
    select h.id, h.hotlist_embedding as emb, coalesce(h.posted_at, h.created_at) as at, h.created_by_account_id,
      h.visa_type, h.locations, h.candidate_summary
    from public.social_hotlist h
    where h.hidden_at is null and h.hotlist_embedding is not null
      and (h.post_source <> 'linkedin_scrape' or coalesce(btrim(h.bench_sales_recruiter_email), '') <> '')
      and coalesce(h.post_status, 'open') = 'open'
      and coalesce(h.posted_at, h.created_at) >= now() - p_backfill_window
      and public.pp_hotlist_lead_ok(h.country, h.job_category, h.role_title, h.locations)
  ),
  pairs as (
    select s.account_id, s.id as subject_id, l.id as lead_id, (1 - (s.emb <=> l.emb))::real as sim,
      s.extracted_visa_types, s.post_content, s.location, l.visa_type, l.locations, l.candidate_summary
    from subjects s
    join leads l on l.at >= now() - s.win and l.created_by_account_id is distinct from s.account_id
  ),
  ranked as (
    select p.account_id, p.subject_id, p.lead_id, p.sim,
      row_number() over (partition by p.subject_id order by p.sim desc) as rn
    from pairs p
    where p.sim >= 0.70
      and not exists (select 1 from public.pipeline_cards c where c.subject_id = p.subject_id and c.lead_id = p.lead_id)
      and public.pp_pair_ok(p.extracted_visa_types, p.post_content, p.location, p.visa_type, p.locations, p.candidate_summary)
  )
  insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
  select account_id, 'job', subject_id, 'hotlist', lead_id, sim from ranked where rn <= 15
  on conflict (subject_id, lead_id) do nothing;
  get diagnostics v_added = row_count;
  v_count := v_count + v_added;

  return v_count;
end;
$function$;

create or replace function public.rematch_pipeline_subject(p_subject_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_added integer := 0;
  v_accounts uuid[];
  v_since timestamptz;
begin
  -- Only posts this column hasn't been checked against: those that came in
  -- since its last rematch (30-minute overlap for posts still being embedded),
  -- or the last 36 hours the first time.
  select coalesce(max(m.checked_at), now() - interval '36 hours') - interval '30 minutes' into v_since
  from public.pipeline_match_cursor m where m.subject_id = p_subject_id;
  select array_agg(am.account_id) into v_accounts
  from public.account_members am where am.user_id = auth.uid() and am.status = 'active';

  if exists (select 1 from public.social_hotlist h where h.id = p_subject_id and h.created_by_account_id = any(v_accounts)) then
    with s as (
      select h.id, h.created_by_account_id as account_id, h.hotlist_embedding as emb, h.visa_type, h.locations, h.candidate_summary
      from public.social_hotlist h where h.id = p_subject_id and h.hotlist_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, j.id as lead_id, (1 - (s.emb <=> j.job_embedding))::real as sim,
        j.extracted_visa_types, j.post_content, j.location, s.visa_type, s.locations, s.candidate_summary
      from s join public.social_jobs j
        on j.hidden_at is null and j.job_embedding is not null and coalesce(j.post_status, 'open') = 'open'
       and j.created_at >= v_since
       and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
       and j.created_by_account_id is distinct from s.account_id
       and public.pp_job_lead_ok(j.country, j.job_category, j.job_title, j.location)
      where not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = j.id)
      order by s.emb <=> j.job_embedding
      limit 15
    )
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
    select account_id, 'hotlist', subject_id, 'job', lead_id, sim from ranked
    where sim >= 0.70
      and public.pp_pair_ok(extracted_visa_types, post_content, location, visa_type, locations, candidate_summary)
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_added = row_count;
  elsif exists (select 1 from public.social_jobs j where j.id = p_subject_id and j.created_by_account_id = any(v_accounts)) then
    with s as (
      select j.id, j.created_by_account_id as account_id, j.job_embedding as emb, j.extracted_visa_types, j.post_content, j.location
      from public.social_jobs j where j.id = p_subject_id and j.job_embedding is not null
    ),
    ranked as (
      select s.account_id, s.id as subject_id, h.id as lead_id, (1 - (s.emb <=> h.hotlist_embedding))::real as sim,
        s.extracted_visa_types, s.post_content, s.location, h.visa_type, h.locations, h.candidate_summary
      from s join public.social_hotlist h
        on h.hidden_at is null and h.hotlist_embedding is not null
       and (h.post_source <> 'linkedin_scrape' or coalesce(btrim(h.bench_sales_recruiter_email), '') <> '') and coalesce(h.post_status, 'open') = 'open'
       and h.created_at >= v_since
       and h.created_by_account_id is distinct from s.account_id
       and public.pp_hotlist_lead_ok(h.country, h.job_category, h.role_title, h.locations)
      where not exists (select 1 from public.pipeline_cards c where c.subject_id = s.id and c.lead_id = h.id)
      order by s.emb <=> h.hotlist_embedding
      limit 15
    )
    insert into public.pipeline_cards (account_id, subject_kind, subject_id, lead_kind, lead_id, similarity)
    select account_id, 'job', subject_id, 'hotlist', lead_id, sim from ranked
    where sim >= 0.70
      and public.pp_pair_ok(extracted_visa_types, post_content, location, visa_type, locations, candidate_summary)
    on conflict (subject_id, lead_id) do nothing;
    get diagnostics v_added = row_count;
  else
    raise exception 'not your post';
  end if;
  insert into public.pipeline_match_cursor (subject_id, checked_at) values (p_subject_id, now())
  on conflict (subject_id) do update set checked_at = now();
  return v_added;
end;
$function$;

-- No more weak top-ups. Kept only so anything that still calls it gets the
-- main matcher's behaviour (0.70, 7 days, same rules).
create or replace function public.fill_sparse_pipeline_columns(p_min integer DEFAULT 5, p_floor real DEFAULT 0.70, p_subject uuid DEFAULT NULL::uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
begin
  return public.refresh_pipeline_cards(interval '36 hours', now() - interval '15 minutes', interval '7 days');
end;
$function$;

create or replace function public.run_pipeline_matcher()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_added integer;
begin
  v_added := public.refresh_pipeline_cards(interval '36 hours', now() - interval '15 minutes', interval '7 days');
  -- Alerts are best-effort: a failure here must not roll back the new cards.
  begin
    perform public.notify_new_tracker_matches();
  exception when others then
    raise warning 'notify_new_tracker_matches failed: %', sqlerrm;
  end;
  return v_added;
end;
$function$;

-- Remove untouched cards the rules would not have created. Cards a user has
-- moved, replied to or closed are left alone.
delete from public.pipeline_cards c
using public.pipeline_cards c2
left join public.social_jobs j on j.id = case when c2.subject_kind = 'hotlist' then c2.lead_id else c2.subject_id end
left join public.social_hotlist h on h.id = case when c2.subject_kind = 'hotlist' then c2.subject_id else c2.lead_id end
where c.id = c2.id
  and c2.stage = 'new'
  and (
       c2.similarity < 0.70
    or (c2.subject_kind = 'hotlist' and j.id is not null and not public.pp_job_lead_ok(j.country, j.job_category, j.job_title, j.location))
    or (c2.subject_kind = 'job' and h.id is not null and not public.pp_hotlist_lead_ok(h.country, h.job_category, h.role_title, h.locations))
    or (j.id is not null and h.id is not null
        and not public.pp_pair_ok(j.extracted_visa_types, j.post_content, j.location, h.visa_type, h.locations, h.candidate_summary))
  );
