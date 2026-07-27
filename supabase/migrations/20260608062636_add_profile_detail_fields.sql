-- Contact details
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS phone         text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email         text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS linkedin_url  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS github_url    text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS portfolio_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city          text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS state         text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS zip_code      text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS country       text NOT NULL DEFAULT '',
  -- Job preferences
  ADD COLUMN IF NOT EXISTS desired_salary_min   integer,
  ADD COLUMN IF NOT EXISTS desired_salary_max   integer,
  ADD COLUMN IF NOT EXISTS work_type            text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS preferred_locations  text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notice_period        text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS visa_status          text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS years_experience     integer,
  ADD COLUMN IF NOT EXISTS availability         text NOT NULL DEFAULT '',
  -- Education (JSON array of objects)
  ADD COLUMN IF NOT EXISTS education   jsonb NOT NULL DEFAULT '[]',
  -- Work experience (JSON array of objects)
  ADD COLUMN IF NOT EXISTS experience  jsonb NOT NULL DEFAULT '[]';
