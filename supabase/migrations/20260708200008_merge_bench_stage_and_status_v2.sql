-- Rename Searching → Sourcing and extend bench_stage to include Placed and Lost

-- Drop old check constraint first so we can update freely
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_bench_stage_check;

-- Rename existing 'Searching' values to 'Sourcing'
UPDATE profiles SET bench_stage = 'Sourcing' WHERE bench_stage = 'Searching';

-- Migrate profile_status Placed/Lost into bench_stage
UPDATE profiles SET bench_stage = 'Placed' WHERE profile_status = 'Placed' AND bench_stage NOT IN ('Placed', 'Lost');
UPDATE profiles SET bench_stage = 'Lost'   WHERE profile_status = 'Lost'   AND bench_stage NOT IN ('Placed', 'Lost');

-- Add new check constraint with full set of stages
ALTER TABLE profiles ADD CONSTRAINT profiles_bench_stage_check
  CHECK (bench_stage IN ('New', 'Assigned', 'Sourcing', 'Submitted', 'Placed', 'Lost'));
