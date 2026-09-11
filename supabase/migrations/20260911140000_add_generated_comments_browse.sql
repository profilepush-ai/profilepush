-- Denormalize post_url/title onto admin_post_comments at write time (the
-- worker already looks up the post's role in the same query) so the new
-- "Generated" browse tab can read comments without re-joining back to
-- social_jobs/social_hotlist per kind.
alter table public.admin_post_comments add column if not exists post_url text;
alter table public.admin_post_comments add column if not exists title text;

create or replace function public.get_admin_generated_comments(
  p_kind text default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table(
  post_id uuid, kind text, post_url text, title text, comment text,
  matching_count integer, generated_at timestamptz, total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with filtered as (
    select c.post_id, c.kind, c.post_url, c.title, c.comment, c.matching_count, c.generated_at
    from public.admin_post_comments c
    where c.comment is not null
      and (p_kind is null or c.kind = p_kind)
      and (p_start_date is null or c.generated_at >= p_start_date)
      and (p_end_date is null or c.generated_at <= p_end_date)
  ),
  counted as (
    select count(*) as total_count from filtered
  )
  select f.post_id, f.kind, f.post_url, f.title, f.comment, f.matching_count, f.generated_at, c.total_count
  from filtered f, counted c
  order by f.generated_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.get_admin_generated_comments(text, timestamptz, timestamptz, integer, integer) from public;
grant execute on function public.get_admin_generated_comments(text, timestamptz, timestamptz, integer, integer) to service_role;
