-- Shorten onboarding token to 16 hex characters (8 random bytes)
ALTER TABLE onboarding_tokens
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(8), 'hex');
