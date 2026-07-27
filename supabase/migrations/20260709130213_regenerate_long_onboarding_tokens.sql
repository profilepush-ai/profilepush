-- Regenerate any onboarding tokens longer than 16 chars (old 64-char default)
UPDATE onboarding_tokens
SET token = encode(gen_random_bytes(8), 'hex')
WHERE length(token) > 16;
