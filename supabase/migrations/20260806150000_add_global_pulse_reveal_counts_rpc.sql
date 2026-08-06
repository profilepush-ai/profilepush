create or replace function public.get_pulse_reveal_counts(p_lead_ids text[])
returns table(lead_id text, reveal_count bigint)
language sql
security definer
set search_path = public
as $$
  select
    pla.lead_id,
    count(*)::bigint as reveal_count
  from public.pulse_lead_actions pla
  where pla.action_type = 'revealed'
    and pla.lead_id = any(coalesce(p_lead_ids, array[]::text[]))
  group by pla.lead_id
$$;

revoke all on function public.get_pulse_reveal_counts(text[]) from public;
grant execute on function public.get_pulse_reveal_counts(text[]) to authenticated;
