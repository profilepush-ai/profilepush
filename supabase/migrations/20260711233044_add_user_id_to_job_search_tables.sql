ALTER TABLE linkedin_job_searches    ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE dice_job_searches        ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE indeed_job_searches      ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE monster_job_searches     ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE careerbuilder_job_searches ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
