-- Indexes for wishlisted_jobs (most frequently joined/filtered)
CREATE INDEX IF NOT EXISTS idx_wishlisted_jobs_profile_id   ON wishlisted_jobs (profile_id);
CREATE INDEX IF NOT EXISTS idx_wishlisted_jobs_created_at   ON wishlisted_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wishlisted_jobs_status       ON wishlisted_jobs (profile_id, status);

-- Indexes for activity_logs (dashboard + profile detail queries)
CREATE INDEX IF NOT EXISTS idx_activity_logs_profile_id     ON activity_logs (profile_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id        ON activity_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at     ON activity_logs (created_at DESC);

-- Indexes for job tables (history view date filtering)
CREATE INDEX IF NOT EXISTS idx_linkedin_jobs_created_at     ON linkedin_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dice_jobs_created_at         ON dice_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_indeed_jobs_created_at       ON indeed_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monster_jobs_created_at      ON monster_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_careerbuilder_jobs_created_at ON careerbuilder_jobs (created_at DESC);

-- Indexes for job tables by search_id (profile scoping)
CREATE INDEX IF NOT EXISTS idx_linkedin_jobs_search_id      ON linkedin_jobs (search_id);
CREATE INDEX IF NOT EXISTS idx_dice_jobs_search_id          ON dice_jobs (search_id);
CREATE INDEX IF NOT EXISTS idx_indeed_jobs_search_id        ON indeed_jobs (search_id);
CREATE INDEX IF NOT EXISTS idx_monster_jobs_search_id       ON monster_jobs (search_id);
CREATE INDEX IF NOT EXISTS idx_careerbuilder_jobs_search_id ON careerbuilder_jobs (search_id);

-- Indexes for job_match_scores
CREATE INDEX IF NOT EXISTS idx_job_match_scores_profile_id  ON job_match_scores (profile_id);

-- Indexes for resume_files
CREATE INDEX IF NOT EXISTS idx_resume_files_profile_id      ON resume_files (profile_id);

-- Indexes for profiles
CREATE INDEX IF NOT EXISTS idx_profiles_created_at          ON profiles (created_at DESC);
