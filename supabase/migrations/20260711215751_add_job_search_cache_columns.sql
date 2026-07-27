-- Add caching columns to all job search tables
ALTER TABLE dice_job_searches
  ADD COLUMN IF NOT EXISTS cached boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cache_source_search_id uuid REFERENCES dice_job_searches(id) ON DELETE SET NULL;

ALTER TABLE indeed_job_searches
  ADD COLUMN IF NOT EXISTS cached boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cache_source_search_id uuid REFERENCES indeed_job_searches(id) ON DELETE SET NULL;

ALTER TABLE linkedin_job_searches
  ADD COLUMN IF NOT EXISTS cached boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cache_source_search_id uuid REFERENCES linkedin_job_searches(id) ON DELETE SET NULL;

ALTER TABLE monster_job_searches
  ADD COLUMN IF NOT EXISTS cached boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cache_source_search_id uuid REFERENCES monster_job_searches(id) ON DELETE SET NULL;

ALTER TABLE careerbuilder_job_searches
  ADD COLUMN IF NOT EXISTS cached boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cache_source_search_id uuid REFERENCES careerbuilder_job_searches(id) ON DELETE SET NULL;

-- Fast lookup indexes for cache queries (only index non-cached live results)
CREATE INDEX IF NOT EXISTS dice_searches_cache_idx
  ON dice_job_searches(keyword, location, posted_date, status, created_at DESC)
  WHERE cached = false;

CREATE INDEX IF NOT EXISTS indeed_searches_cache_idx
  ON indeed_job_searches(keyword, location, date_posted, status, created_at DESC)
  WHERE cached = false;

CREATE INDEX IF NOT EXISTS linkedin_searches_cache_idx
  ON linkedin_job_searches(job_title, location, posted_within, experience_level, employment_type, work_arrangement, status, created_at DESC)
  WHERE cached = false;

CREATE INDEX IF NOT EXISTS monster_searches_cache_idx
  ON monster_job_searches(keyword, location, status, created_at DESC)
  WHERE cached = false;

CREATE INDEX IF NOT EXISTS careerbuilder_searches_cache_idx
  ON careerbuilder_job_searches(keyword, location, date_posted, status, created_at DESC)
  WHERE cached = false;
