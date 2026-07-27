ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS profile_status text NOT NULL DEFAULT 'Active'
    CHECK (profile_status IN ('Active', 'Placed', 'Lost'));
