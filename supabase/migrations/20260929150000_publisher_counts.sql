-- Totals for the top of the Vendors / Bench Recs page: how many publishers of
-- the kind the viewer reads exist, and how many the account subscribes to.
create or replace function public.get_publisher_counts(p_kind text)
returns table (total integer, following integer)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
begin
  if auth.uid() is null or p_kind not in ('job', 'hotlist') then return; end if;
  return query
  select
    (select count(*)::integer from public.publisher_profiles p
      where (case when p_kind = 'job' then p.last_job_post_at else p.last_hotlist_post_at end) is not null),
    (select count(*)::integer from public.publisher_follows f
      join public.publisher_profiles p on p.id = f.publisher_id
      where f.account_id = v_account
        and (case when p_kind = 'job' then p.last_job_post_at else p.last_hotlist_post_at end) is not null);
end;
$$;

revoke all on function public.get_publisher_counts(text) from public, anon;
grant execute on function public.get_publisher_counts(text) to authenticated;
