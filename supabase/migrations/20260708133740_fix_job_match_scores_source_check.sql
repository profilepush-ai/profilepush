ALTER TABLE job_match_scores DROP CONSTRAINT job_match_scores_job_source_check;

ALTER TABLE job_match_scores ADD CONSTRAINT job_match_scores_job_source_check CHECK (
  (
    (linkedin_job_id      IS NOT NULL)::int +
    (dice_job_id          IS NOT NULL)::int +
    (indeed_job_id        IS NOT NULL)::int +
    (monster_job_id       IS NOT NULL)::int +
    (careerbuilder_job_id IS NOT NULL)::int
  ) = 1
);
