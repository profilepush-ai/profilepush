alter table public.social_hotlist
  add column if not exists consultant_count integer,
  add column if not exists post_scope text;

with source_counts as (
  select platform, source_post_id, count(*)::integer as consultant_count
  from public.social_hotlist
  group by platform, source_post_id
)
update public.social_hotlist hotlist
set consultant_count = counts.consultant_count,
    post_scope = case when counts.consultant_count = 1 then 'single' else 'multiple' end
from source_counts counts
where counts.platform = hotlist.platform
  and counts.source_post_id = hotlist.source_post_id;

alter table public.social_hotlist
  alter column consultant_count set not null,
  alter column post_scope set not null,
  add constraint social_hotlist_consultant_count_check check (consultant_count > 0),
  add constraint social_hotlist_post_scope_check check (post_scope in ('single', 'multiple')),
  add constraint social_hotlist_scope_count_check check (
    (post_scope = 'single' and consultant_count = 1)
    or (post_scope = 'multiple' and consultant_count > 1)
  );

create index if not exists idx_social_hotlist_source_post
  on public.social_hotlist (platform, source_post_id, candidate_index);

create or replace function public.get_social_hotlist_source_summary(
  p_limit integer default 100
)
returns table (
  platform text,
  source_post_id text,
  post_scope text,
  consultant_count integer,
  persisted_record_count bigint,
  recruiter_name text,
  recruiter_email text,
  recruiter_phone text,
  recruiter_company text,
  recruiter_details_consistent boolean,
  roles text[],
  latest_created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    hotlist.platform,
    hotlist.source_post_id,
    max(hotlist.post_scope),
    max(hotlist.consultant_count),
    count(*),
    max(hotlist.bench_sales_recruiter_name),
    max(hotlist.bench_sales_recruiter_email),
    max(hotlist.bench_sales_recruiter_phone),
    max(hotlist.bench_sales_company_name),
    count(distinct row(
      hotlist.bench_sales_recruiter_name,
      hotlist.bench_sales_recruiter_email,
      hotlist.bench_sales_recruiter_phone,
      hotlist.bench_sales_company_name,
      hotlist.recruiter_profile_link
    )) = 1,
    array_agg(hotlist.role_title order by hotlist.candidate_index),
    max(hotlist.created_at)
  from public.social_hotlist hotlist
  group by hotlist.platform, hotlist.source_post_id
  order by max(hotlist.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;

revoke all on function public.get_social_hotlist_source_summary(integer) from public;
grant execute on function public.get_social_hotlist_source_summary(integer)
  to authenticated, service_role;