create or replace function public.get_pulse_reveal_names(
  p_lead_ids text[],
  p_limit_per_lead integer default 3
)
returns table(lead_id text, revealer_names text[])
language sql
security definer
set search_path = public
as $$
  with reveal_events as (
    select
      pla.lead_id,
      coalesce(
        nullif(trim(am.display_name), ''),
        nullif(split_part(am.invited_email, '@', 1), ''),
        'Unknown'
      ) as revealer_name,
      max(pla.created_at) as revealed_at
    from public.pulse_lead_actions pla
    left join public.account_members am
      on am.account_id = pla.account_id
      and am.user_id = pla.user_id
    where pla.action_type = 'revealed'
      and pla.lead_id = any(coalesce(p_lead_ids, array[]::text[]))
    group by pla.lead_id, revealer_name
  ), ranked as (
    select
      lead_id,
      revealer_name,
      revealed_at,
      row_number() over (partition by lead_id order by revealed_at desc) as rn
    from reveal_events
  )
  select
    lead_id,
    array_agg(revealer_name order by revealed_at desc) as revealer_names
  from ranked
  where rn <= greatest(coalesce(p_limit_per_lead, 3), 1)
  group by lead_id
$$;

revoke all on function public.get_pulse_reveal_names(text[], integer) from public;
grant execute on function public.get_pulse_reveal_names(text[], integer) to authenticated;
