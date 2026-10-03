-- The first backfill stamped every card with the time it ran, so they all
-- looked like matches from the last 2 hours. Date them by when the matched
-- post went up instead (live cards are created within minutes of the post).
update public.pipeline_cards c
set created_at = least(c.created_at, coalesce(j.posted_at, j.created_at)),
    stage_changed_at = case when c.stage = 'new' then least(c.stage_changed_at, coalesce(j.posted_at, j.created_at)) else c.stage_changed_at end
from public.social_jobs j
where c.lead_kind = 'job' and j.id = c.lead_id and coalesce(j.posted_at, j.created_at) < c.created_at;

update public.pipeline_cards c
set created_at = least(c.created_at, coalesce(h.posted_at, h.created_at)),
    stage_changed_at = case when c.stage = 'new' then least(c.stage_changed_at, coalesce(h.posted_at, h.created_at)) else c.stage_changed_at end
from public.social_hotlist h
where c.lead_kind = 'hotlist' and h.id = c.lead_id and coalesce(h.posted_at, h.created_at) < c.created_at;
