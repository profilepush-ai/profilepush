ALTER TABLE account_members
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS data_access text NOT NULL DEFAULT 'full'
    CHECK (data_access IN ('full', 'assigned_only'));
