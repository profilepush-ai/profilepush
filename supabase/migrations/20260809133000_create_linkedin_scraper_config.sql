create table if not exists public.linkedin_scraper_config (
  id boolean primary key default true check (id),
  is_enabled boolean not null default true,
  max_pages integer not null default 1 check (max_pages between 1 and 20),
  max_posts_per_group integer not null default 100 check (max_posts_per_group between 1 and 1000),
  posted_limit text not null default '24h' check (posted_limit in ('24h', 'week', 'month')),
  sort_by text not null default 'date' check (sort_by in ('date', 'relevance')),
  schedule_interval_hours integer not null default 3 check (schedule_interval_hours between 1 and 24),
  last_scheduled_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.linkedin_scraper_config (id) values (true)
on conflict (id) do nothing;

alter table public.linkedin_scraper_config enable row level security;
revoke all on table public.linkedin_scraper_config from anon, authenticated;
grant select, insert, update on table public.linkedin_scraper_config to service_role;