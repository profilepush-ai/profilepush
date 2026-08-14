alter table public.social_hotlist
  add column if not exists source_image_urls text[] not null default '{}';
