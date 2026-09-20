-- "N new jobs match your consultants", per account.
--
-- Feeds the daily engagement notification. For every open consultant a bench
-- sales account has posted, count the jobs that arrived since p_since and sit
-- within p_min_similarity of that consultant in embedding space — the same
-- vectors AI Match searches, so the count means the same thing the product
-- does.
--
-- Threshold: measured over a week of live data, the best consultant-to-job
-- similarity is ~0.80, and 0.70 yields roughly ten matched jobs per account
-- per weekday. Higher barely ever fires; lower turns into noise.

create or replace function public.new_job_matches_since(
  p_since timestamptz default now() - interval '24 hours',
  p_min_similarity double precision default 0.70
)
returns table (
  account_id uuid,
  consultant_count integer,
  matched_jobs integer,
  sample_title text
)
language sql
stable
security definer
-- pgvector lives in the extensions schema on this project.
set search_path = public, extensions
as $$
  with consultants as (
    select h.created_by_account_id as account_id, h.id, h.hotlist_embedding as emb
    from public.social_hotlist h
    where h.post_source = 'user_post'
      and h.post_status = 'open'
      and h.hidden_at is null
      and h.hotlist_embedding is not null
      and h.created_by_account_id is not null
  ),
  jobs as (
    select j.id, j.job_title, j.job_embedding as emb
    from public.social_jobs j
    where j.hidden_at is null
      and j.job_embedding is not null
      and coalesce(j.posted_at, j.created_at) >= coalesce(p_since, now() - interval '24 hours')
      -- Same contactability rule the feed applies: a scraped job with no
      -- contact is not something anyone can act on.
      and (j.post_source <> 'linkedin_scrape' or coalesce(btrim(j.poster_email), '') <> '')
  ),
  -- Best similarity per (account, job): a job counts once however many of the
  -- account's consultants it suits.
  pairs as (
    select c.account_id, j.id as job_id, j.job_title, max(1 - (c.emb <=> j.emb)) as sim
    from consultants c
    cross join jobs j
    group by 1, 2, 3
  )
  select
    p.account_id,
    (select count(distinct c.id)::integer from consultants c where c.account_id = p.account_id) as consultant_count,
    count(*)::integer as matched_jobs,
    (array_agg(p.job_title order by p.sim desc))[1] as sample_title
  from pairs p
  where p.sim >= coalesce(p_min_similarity, 0.70)
  group by p.account_id;
$$;

-- Service role only: this is read by the notification job, never by a client.
revoke all on function public.new_job_matches_since(timestamptz, double precision) from public, anon, authenticated;
grant execute on function public.new_job_matches_since(timestamptz, double precision) to service_role;
