DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_match_scores_profile_dice_unique'
  ) THEN
    ALTER TABLE job_match_scores ADD CONSTRAINT job_match_scores_profile_dice_unique UNIQUE (profile_id, dice_job_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_match_scores_profile_indeed_unique'
  ) THEN
    ALTER TABLE job_match_scores ADD CONSTRAINT job_match_scores_profile_indeed_unique UNIQUE (profile_id, indeed_job_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_match_scores_profile_monster_unique'
  ) THEN
    ALTER TABLE job_match_scores ADD CONSTRAINT job_match_scores_profile_monster_unique UNIQUE (profile_id, monster_job_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_match_scores_profile_cb_unique'
  ) THEN
    ALTER TABLE job_match_scores ADD CONSTRAINT job_match_scores_profile_cb_unique UNIQUE (profile_id, careerbuilder_job_id);
  END IF;
END $$;
