create table if not exists public.linkedin_groups_posts (
  id bigint generated always as identity primary key,
  scrape_run_id uuid not null,
  group_id text not null references public.linkedin_groups (group_id) on delete cascade,
  harvest_page integer not null check (harvest_page > 0),
  item_index integer not null check (item_index >= 0),
  raw_post jsonb not null,
  scraped_at timestamptz not null default now(),
  unique (scrape_run_id, group_id, harvest_page, item_index)
);

create index if not exists idx_linkedin_groups_posts_group_scraped
  on public.linkedin_groups_posts (group_id, scraped_at desc);

alter table public.linkedin_groups_posts enable row level security;

revoke all on table public.linkedin_groups_posts from anon, authenticated;
grant select, insert, update, delete on table public.linkedin_groups_posts to service_role;
grant usage, select on sequence public.linkedin_groups_posts_id_seq to service_role;