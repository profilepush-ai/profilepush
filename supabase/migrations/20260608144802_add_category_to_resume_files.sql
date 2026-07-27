ALTER TABLE resume_files ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'resume';
CREATE INDEX IF NOT EXISTS resume_files_category_idx ON resume_files(profile_id, category);
