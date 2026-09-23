-- Screening links were 64 characters of hex:
--   replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
--
-- Two UUIDs is 256 bits for a link that guards one video interview, and it
-- produces a URL long enough to wrap in an email client and break when it is
-- forwarded — which is exactly what happens to these, since the bench sales
-- recruiter forwards the link to their consultant.
--
-- One UUID rendered as base64url is 22 characters and still 128 bits, which
-- is the same strength as a v4 UUID and more than enough for a token that
-- also requires knowing nothing else to be useful. encode and decode are core
-- Postgres, so this needs no extension and no search_path games.
--
-- Existing tokens are untouched and keep working: the column is only a
-- default, and nothing validates a token's length.

alter table public.job_applications
  alter column screening_token
  set default rtrim(
    translate(
      encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
      '+/', '-_'
    ),
    '='
  );
