create or replace function public.claim_linkedin_groups_for_scrape(
  p_group_ids text[],
  p_interval_hours numeric,
  p_force boolean default false
)
returns table (group_id text)
language sql
security definer
set search_path = public
as $$
  update public.linkedin_groups groups
  set
    last_scraped_at = now(),
    updated_at = now()
  where groups.is_active = true
    and groups.group_id = any(coalesce(p_group_ids, '{}'::text[]))
    and (
      coalesce(p_force, false)
      or groups.last_scraped_at is null
      or groups.last_scraped_at <= now() - make_interval(hours => greatest(coalesce(p_interval_hours, 24), 1)::integer)
    )
  returning groups.group_id;
$$;

revoke all on function public.claim_linkedin_groups_for_scrape(text[], numeric, boolean) from public;
grant execute on function public.claim_linkedin_groups_for_scrape(text[], numeric, boolean) to service_role;