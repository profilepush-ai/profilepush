-- Every column has its own stage switcher, so counts are per column: New in
-- the last 2 hours (p_new_since), every other stage since p_since (today).
drop function if exists public.get_pipeline_stage_counts(text, timestamptz, timestamptz);

create or replace function public.get_pipeline_column_counts(p_kind text, p_new_since timestamptz, p_since timestamptz)
returns table (subject_id uuid, stage text, n integer)
language sql
stable
security definer
set search_path = public
as $$
  select c.subject_id, c.stage, count(*)::integer
  from public.pipeline_cards c
  where c.subject_kind = p_kind
    and case when c.stage = 'new' then c.created_at >= p_new_since else c.stage_changed_at >= p_since end
    and c.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active')
  group by c.subject_id, c.stage;
$$;

revoke all on function public.get_pipeline_column_counts(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_pipeline_column_counts(text, timestamptz, timestamptz) to authenticated;
