/*
# Market fields on ingested posts

ProfilePush has only ingested US IT staffing posts so far, so nothing recorded
which market a post belongs to. These columns let posts from other countries
and non-IT roles be told apart (and counted) once they are ingested.

All columns are nullable and filled by receive-social-job from the parser's
answer; rows ingested before this, and posts where the parser can't tell, stay
null ("unknown"). No constraints: the edge function normalises every value, and
a constraint failure would drop the whole batch of posts.

social_jobs
  country       two-letter ISO country code where the role is based (US, CA, GB, AU, AE, SA, IN, ...)
  job_category  'IT' or 'Non-IT'
  pay_min/max   the pay exactly as stated in the post, in pay_currency per pay_period
  pay_currency  three-letter currency code (USD, GBP, CAD, AED, ...)
  pay_period    hour, day, week, month or year
  (extracted_hourly_rate_* keep meaning a USD hourly rate.)

social_hotlist
  country, job_category  for the post as a whole.
*/

alter table public.social_jobs
  add column if not exists country text,
  add column if not exists job_category text,
  add column if not exists pay_min numeric,
  add column if not exists pay_max numeric,
  add column if not exists pay_currency text,
  add column if not exists pay_period text;

alter table public.social_hotlist
  add column if not exists country text,
  add column if not exists job_category text;
