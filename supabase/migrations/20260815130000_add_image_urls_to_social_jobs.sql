-- receive-social-job started writing image_urls to social_jobs upserts (commit b69b7e6),
-- but only social_hotlist got a matching column (source_image_urls). Every social_jobs
-- upsert since has failed with "Could not find the 'image_urls' column in the schema cache",
-- silently wedging the LinkedIn job pipeline.
alter table public.social_jobs
  add column if not exists image_urls text[] not null default '{}';
