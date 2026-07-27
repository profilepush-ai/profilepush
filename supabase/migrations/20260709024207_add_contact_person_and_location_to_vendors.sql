ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS contact_person text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS location       text NOT NULL DEFAULT '';
