ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bench_stage text NOT NULL DEFAULT 'New'
  CHECK (bench_stage IN ('New', 'Assigned', 'Searching', 'Submitted'));

CREATE INDEX IF NOT EXISTS profiles_bench_stage_idx ON profiles(bench_stage);
