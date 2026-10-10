/*
# Minimum match is a paid feature

Free accounts match at 70% (the standard cut-off); paid accounts
(account_has_paid) choose 50-80%. Enforced where it is set, so the matchers
and AI Match keep reading accounts.match_min_score as they are. Free accounts
that had already changed it go back to 70.
*/

update public.accounts set match_min_score = 70
where match_min_score <> 70 and not public.account_has_paid(id);

drop function if exists public.set_match_min_score(integer);
create function public.set_match_min_score(p_score integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_account uuid;
begin
  select am.account_id into v_account from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active' order by am.created_at limit 1;
  if v_account is null then return jsonb_build_object('error', 'no_account'); end if;
  if not public.account_has_paid(v_account) then
    return jsonb_build_object('error', 'paid_only', 'score', 70);
  end if;
  update public.accounts set match_min_score = greatest(50, least(80, p_score)) where id = v_account;
  return jsonb_build_object('score', greatest(50, least(80, p_score)));
end;
$$;
revoke all on function public.set_match_min_score(integer) from public, anon;
grant execute on function public.set_match_min_score(integer) to authenticated;
