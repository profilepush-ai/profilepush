-- The suggestion list was capped at 12 publishers drawn from the 200 most
-- recent posters, so the page showed only a handful. Every publisher active
-- this week is now eligible, and the client asks for up to 300 and pages
-- through them with "Show more".
create or replace function public.get_suggested_publishers(p_kind text, p_limit integer default 12)
returns table (
  publisher_id uuid,
  slug text,
  display_name text,
  company_name text,
  avatar_url text,
  is_claimed boolean,
  post_count integer,
  top_roles text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_ids uuid[];
begin
  if v_account is null or p_kind not in ('job', 'hotlist') then return; end if;

  select array_agg(p.id) into v_ids
  from (
    select p.id
    from public.publisher_profiles p
    where (case when p_kind = 'job' then p.last_job_post_at else p.last_hotlist_post_at end) >= now() - interval '7 days'
      and p.claimed_account_id is distinct from v_account
      and not exists (select 1 from public.publisher_follows f where f.account_id = v_account and f.publisher_id = p.id)
    order by (case when p_kind = 'job' then p.last_job_post_at else p.last_hotlist_post_at end) desc
    limit 2000
  ) p;
  if v_ids is null then return; end if;

  return query
  with posts as (
    select * from public.publisher_recent_posts(v_ids, p_kind, 7)
  )
  select p.id, p.slug, p.display_name, p.company_name, p.avatar_url, p.claimed_account_id is not null,
    count(*)::integer,
    coalesce((select array_agg(r) from (
      select r from posts po2, unnest(po2.roles) r where po2.publisher_id = p.id
      group by r order by count(*) desc, r limit 3) t), '{}'::text[])
  from posts po
  join public.publisher_profiles p on p.id = po.publisher_id
  group by p.id
  order by count(*) desc, max(po.posted_at) desc
  limit greatest(1, least(coalesce(p_limit, 12), 300));
end;
$$;

