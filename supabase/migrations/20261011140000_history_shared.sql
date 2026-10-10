/*
# History > Shared

A fourth History tab: matches you shared (the Share button records a
'shared' lead action), newest share first. Items carry shared_at.
*/

create or replace function public.get_history(p_kind text default 'hotlist', p_tab text default 'viewed', p_tz text default 'UTC')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_kind text := case when p_kind = 'job' then 'job' else 'hotlist' end;
  v_day timestamptz := public.pp_day_start(p_tz);
  v_items jsonb;
begin
  if v_account is null then return null; end if;
  select coalesce(jsonb_agg(public.pp_card_item_json(p) || case when p_tab = 'shared' then jsonb_build_object('shared_at', k.sort_at) else '{}'::jsonb end
    order by k.sort_at desc), '[]'::jsonb)
  into v_items
  from (
    select c.id,
      case p_tab when 'saved' then c.saved_at when 'applied' then c.applied_at
        when 'shared' then (select max(a.created_at) from public.pulse_lead_actions a
          where a.account_id = c.account_id and a.lead_id = c.lead_id::text and a.action_type = 'shared')
        else c.viewed_at end as sort_at
    from public.pipeline_cards c
    where c.account_id = v_account and c.subject_kind = v_kind
      and case p_tab
        when 'saved' then c.saved_at is not null and c.stage = 'new'
        when 'applied' then c.applied_at is not null
        when 'shared' then exists (select 1 from public.pulse_lead_actions a
          where a.account_id = c.account_id and a.lead_id = c.lead_id::text and a.action_type = 'shared')
        else c.stage = 'new' and c.saved_at is null and c.viewed_at < v_day
      end
    order by sort_at desc nulls last
    limit 200
  ) k join public.pipeline_cards p on p.id = k.id;
  return jsonb_build_object(
    'tab', p_tab,
    'counts', (
      select jsonb_build_object(
        'viewed', count(*) filter (where c.stage = 'new' and c.saved_at is null and c.viewed_at < v_day),
        'saved', count(*) filter (where c.saved_at is not null and c.stage = 'new'),
        'applied', count(*) filter (where c.applied_at is not null),
        'shared', count(*) filter (where exists (select 1 from public.pulse_lead_actions a
          where a.account_id = c.account_id and a.lead_id = c.lead_id::text and a.action_type = 'shared')))
      from public.pipeline_cards c where c.account_id = v_account and c.subject_kind = v_kind),
    'items', v_items
  );
end;
$$;
revoke all on function public.get_history(text, text, text) from public, anon;
grant execute on function public.get_history(text, text, text) to authenticated;
