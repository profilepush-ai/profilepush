-- Website Modernization: demo requests from the /websites landing page.
-- A business owner leaves their current website and contact details; we
-- rebuild the site from that content and send them a private demo link.
--
-- Anyone (signed in or not) can submit. Nobody can read through the API:
-- requests are reviewed with the service role (admin tooling), so one
-- visitor can never see another's details.
create table if not exists public.website_demo_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320 and email like '%@%'),
  phone text check (char_length(phone) <= 40),
  company text not null check (char_length(company) between 1 and 200),
  website_url text not null check (char_length(website_url) between 4 and 500),
  notes text check (char_length(notes) <= 2000),
  user_id uuid references auth.users(id) on delete set null,
  source text not null default 'websites_landing' check (char_length(source) <= 60),
  status text not null default 'new' check (status in ('new', 'in_progress', 'demo_sent', 'claimed', 'declined'))
);

create index if not exists website_demo_requests_created_at_idx on public.website_demo_requests (created_at desc);
create index if not exists website_demo_requests_status_idx on public.website_demo_requests (status);

alter table public.website_demo_requests enable row level security;

drop policy if exists "anyone_can_request_website_demo" on public.website_demo_requests;
create policy "anyone_can_request_website_demo" on public.website_demo_requests
  for insert to anon, authenticated
  with check (
    status = 'new'
    and (user_id is null or user_id = auth.uid())
  );

grant insert on public.website_demo_requests to anon, authenticated;
