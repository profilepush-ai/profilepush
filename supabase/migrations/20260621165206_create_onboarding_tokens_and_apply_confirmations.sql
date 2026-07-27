
-- Shareable candidate onboarding tokens
CREATE TABLE IF NOT EXISTS onboarding_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  label text NOT NULL DEFAULT 'Candidate Onboarding',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days',
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE onboarding_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_select_tokens" ON onboarding_tokens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM account_members
    WHERE account_members.account_id = onboarding_tokens.account_id
      AND account_members.user_id = auth.uid()
      AND account_members.status = 'active'
  ));

CREATE POLICY "members_insert_tokens" ON onboarding_tokens FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM account_members
    WHERE account_members.account_id = onboarding_tokens.account_id
      AND account_members.user_id = auth.uid()
      AND account_members.status = 'active'
  ));

CREATE POLICY "members_update_tokens" ON onboarding_tokens FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM account_members
    WHERE account_members.account_id = onboarding_tokens.account_id
      AND account_members.user_id = auth.uid()
      AND account_members.status = 'active'
  ));

-- Public read so candidates can submit via the link (anon access by token)
CREATE POLICY "anon_read_active_tokens" ON onboarding_tokens FOR SELECT TO anon
  USING (is_active = true AND expires_at > now());


-- Apply confirmation links — sent to candidates to confirm they applied
CREATE TABLE IF NOT EXISTS apply_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wishlisted_job_id uuid NOT NULL REFERENCES wishlisted_jobs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE apply_confirmations ENABLE ROW LEVEL SECURITY;

-- Authenticated team members can manage confirmations for their account's profiles
CREATE POLICY "auth_select_confirmations" ON apply_confirmations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles p
    JOIN account_members am ON am.account_id = p.account_id
    WHERE p.id = apply_confirmations.profile_id
      AND am.user_id = auth.uid()
      AND am.status = 'active'
  ));

CREATE POLICY "auth_insert_confirmations" ON apply_confirmations FOR INSERT TO authenticated
  WITH CHECK (true);

-- Anon can read + update (to confirm) by knowing the token
CREATE POLICY "anon_read_confirmations" ON apply_confirmations FOR SELECT TO anon
  USING (true);

CREATE POLICY "anon_update_confirmations" ON apply_confirmations FOR UPDATE TO anon
  USING (confirmed_at IS NULL)
  WITH CHECK (true);
