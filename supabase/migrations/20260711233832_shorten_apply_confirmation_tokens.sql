ALTER TABLE apply_confirmations
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(8), 'hex');

UPDATE apply_confirmations
SET token = encode(gen_random_bytes(8), 'hex')
WHERE length(token) > 16;
