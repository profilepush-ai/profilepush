-- Website Modernization build list: every company domain we know (signed-up
-- users, job and hotlist posters, imported contacts, vendor/bench lists),
-- with its current website checked and a priority to work down. Filled and
-- refreshed by scripts/website-build-list.mjs; worked from Admin > Websites >
-- Build list. Service role only.
create table if not exists public.website_build_list (
  domain text primary key check (domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  company text,
  side text not null check (side in ('bench', 'vendor', 'both', 'other')),
  is_user boolean not null default false,
  user_persona text,
  hotlist_posts integer not null default 0,
  job_posts integer not null default 0,
  sources text[] not null default '{}',
  site_status text not null check (site_status in ('ok', 'thin', 'dead', 'parked')),
  http_status integer,
  final_host text,
  words integer not null default 0,
  title text,
  staffing_score integer not null default 0,
  priority integer not null default 0,
  status text not null default 'todo' check (status in ('todo', 'building', 'built', 'skipped')),
  notes text check (char_length(notes) <= 2000),
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists website_build_list_priority_idx on public.website_build_list (status, priority desc);
create index if not exists website_build_list_side_idx on public.website_build_list (side, site_status);

alter table public.website_build_list enable row level security;
revoke all on public.website_build_list from public, anon, authenticated;
grant all on public.website_build_list to service_role;

-- Every company domain we know, with how active it is, for the build-list
-- script. Personal mail providers, .edu and .gov are left out.
create or replace function public.website_build_list_sources()
returns table (domain text, sources text[], hotlist_posts bigint, job_posts bigint, is_user boolean, user_persona text)
language sql
stable
security definer
set search_path = public
as $$
  with src as (
    select lower(split_part(trim(bench_sales_recruiter_email), '@', 2)) d, 'hotlist'::text s from public.social_hotlist where bench_sales_recruiter_email like '%@%.%'
    union all select lower(split_part(trim(poster_email), '@', 2)), 'jobs' from public.social_jobs where poster_email like '%@%.%'
    union all select lower(split_part(trim(email), '@', 2)), 'publisher' from public.publisher_profiles where email like '%@%.%'
    union all select lower(split_part(trim(email), '@', 2)), 'social_vendors' from public.social_vendors where email like '%@%.%'
    union all select lower(split_part(trim(email), '@', 2)), 'vendors' from public.vendors where email like '%@%.%'
    union all select lower(split_part(trim(email), '@', 2)), 'imported' from public.imported_email_contacts where email like '%@%.%'
    union all select lower(split_part(trim(email), '@', 2)), 'clients' from public.clients where email like '%@%.%'
  ),
  users as (
    select lower(split_part(u.email, '@', 2)) d, a.active_persona p
    from auth.users u
    join public.account_members m on m.user_id = u.id and m.status = 'active'
    join public.accounts a on a.id = m.account_id
    where u.email like '%@%.%'
  ),
  allrows as (
    select d, s, null::text p from src
    union all select d, 'user', p from users
  )
  select d,
    array_agg(distinct s),
    count(*) filter (where s = 'hotlist'),
    count(*) filter (where s = 'jobs'),
    bool_or(s = 'user'),
    case when bool_or(p = 'bench_sales') then 'bench_sales' when bool_or(p = 'vendor') then 'vendor' else max(p) end
  from allrows
  where d ~ '^[a-z0-9.-]+\.[a-z]{2,}$'
    and d !~ '\.(edu|gov)$'
    and d not in ('gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com','live.com','protonmail.com','proton.me','ymail.com','rediffmail.com','msn.com','me.com','zoho.com','mail.com','gmx.com','yahoo.co.in','googlemail.com','zohomail.in','zohomail.com','yandex.com','qq.com','163.com')
  group by d
$$;

revoke all on function public.website_build_list_sources() from public, anon, authenticated;
grant execute on function public.website_build_list_sources() to service_role;
