-- Add profile_id to all 5 search tables so job history can be scoped per profile

ALTER TABLE linkedin_job_searches     ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE dice_job_searches         ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE indeed_job_searches       ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE monster_job_searches      ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE careerbuilder_job_searches ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_linkedin_searches_profile     ON linkedin_job_searches     (profile_id);
CREATE INDEX IF NOT EXISTS idx_dice_searches_profile         ON dice_job_searches         (profile_id);
CREATE INDEX IF NOT EXISTS idx_indeed_searches_profile       ON indeed_job_searches       (profile_id);
CREATE INDEX IF NOT EXISTS idx_monster_searches_profile      ON monster_job_searches      (profile_id);
CREATE INDEX IF NOT EXISTS idx_careerbuilder_searches_profile ON careerbuilder_job_searches (profile_id);
