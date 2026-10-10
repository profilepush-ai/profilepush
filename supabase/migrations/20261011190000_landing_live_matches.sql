/*
# Live matches on the landing page

The landing page's top card plays the latest real matches of IT jobs. Only
the job side goes out: its title, company, location, rate, skills and AI
picture, with the match score and when it matched. Nothing about the
profile or the account, and not the poster's name or photo. Public, at
most 12, from the last 24 hours, one per job.
*/

create index if not exists pipeline_cards_added_idx on public.pipeline_cards (added_at desc);

create or replace function public.landing_live_matches()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with recent as (
    select distinct on (c.lead_id) c.lead_id, c.fit_score, c.added_at
    from public.pipeline_cards c
    where c.added_at > now() - interval '24 hours'
      and c.lead_kind = 'job' and c.subject_kind = 'hotlist'
      and c.fit_score >= 75
    order by c.lead_id, c.added_at desc
  ), shown as (
    select r.*, j, p.url as picture
    from recent r
    join public.social_jobs j on j.id = r.lead_id
    -- Either the woman or the man version, mixed across jobs.
    cross join lateral (
      select v.url from public.match_visuals v
      where v.lead_id = r.lead_id and v.url is not null and v.variant in ('a', 'b')
      order by v.variant = (case when hashtext(r.lead_id::text) & 1 = 0 then 'a' else 'b' end) desc
      limit 1) p
    where coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null
      and j.job_category = 'IT'
      and nullif(btrim(j.company_name), '') is not null
    order by r.added_at desc
    limit 12
  )
  select coalesce(jsonb_agg(m.item order by m.matched_at desc), '[]'::jsonb) from (
    select s.added_at as matched_at, jsonb_build_object(
      'id', (s.j).id,
      'title', coalesce(nullif(btrim((s.j).job_title), ''), 'Job'),
      'company', btrim((s.j).company_name),
      'location', nullif(btrim((s.j).location), ''),
      'rate_min', (s.j).extracted_hourly_rate_min, 'rate_max', (s.j).extracted_hourly_rate_max,
      -- The job's own skills; short names fit on a chip.
      'skills', (
        select coalesce(jsonb_agg(e.name order by e.n), '[]'::jsonb)
        from (
          select e.name, e.n
          from jsonb_array_elements_text(case when jsonb_typeof((s.j).extracted_skills) = 'array' then (s.j).extracted_skills else '[]'::jsonb end)
            with ordinality as e(name, n)
          where length(e.name) between 1 and 22
          limit 5
        ) e),
      'fit', s.fit_score,
      'matched_at', s.added_at,
      'posted_at', coalesce((s.j).posted_at, (s.j).created_at),
      'how', case when (s.j).post_source = 'career_site' then 'site' else 'email' end,
      'picture', s.picture
    ) as item
    from shown s
  ) m
$$;
revoke all on function public.landing_live_matches() from public;
grant execute on function public.landing_live_matches() to anon, authenticated;
