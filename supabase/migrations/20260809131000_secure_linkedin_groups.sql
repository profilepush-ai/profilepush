drop policy if exists select_all_linkedin_groups on public.linkedin_groups;
drop policy if exists insert_all_linkedin_groups on public.linkedin_groups;
drop policy if exists update_all_linkedin_groups on public.linkedin_groups;
drop policy if exists delete_all_linkedin_groups on public.linkedin_groups;

revoke all on table public.linkedin_groups from anon, authenticated;
grant all on table public.linkedin_groups to service_role;
