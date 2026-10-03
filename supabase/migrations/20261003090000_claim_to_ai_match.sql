-- Claim links now lead to AI Match on the post the email was about, so the
-- "See the 33 matches" in the email is what they see first. A token can
-- carry that post (lead_kind, lead_id); use_profile_claim_token returns it
-- so claim-profile can pass it on.

alter table public.profile_claim_tokens
  add column if not exists lead_kind text,
  add column if not exists lead_id uuid;

drop function if exists public.create_profile_claim_token(uuid);
create or replace function public.create_profile_claim_token(
  p_publisher_id uuid,
  p_lead_kind text default null,
  p_lead_id uuid default null
)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.profile_claim_tokens (publisher_id, lead_kind, lead_id)
  select p.id,
    case when p_lead_kind in ('job', 'hotlist') then p_lead_kind end,
    case when p_lead_kind in ('job', 'hotlist') then p_lead_id end
  from public.publisher_profiles p
  where p.id = p_publisher_id and p.claimed_account_id is null and p.removed_at is null
  returning id;
$$;

drop function if exists public.use_profile_claim_token(uuid);
create function public.use_profile_claim_token(p_token uuid)
returns table (ok boolean, reason text, email text, slug text, lead_kind text, lead_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_token public.profile_claim_tokens%rowtype;
  v_profile public.publisher_profiles%rowtype;
begin
  select * into v_token from public.profile_claim_tokens t where t.id = p_token for update;
  if not found then return query select false, 'not_found', null::text, null::text, null::text, null::uuid; return; end if;
  select * into v_profile from public.publisher_profiles p where p.id = v_token.publisher_id;
  if v_profile.removed_at is not null then return query select false, 'removed', v_profile.email, v_profile.slug, v_token.lead_kind, v_token.lead_id; return; end if;
  if v_token.used_at is not null then return query select false, 'used', v_profile.email, v_profile.slug, v_token.lead_kind, v_token.lead_id; return; end if;
  if v_token.expires_at < now() then return query select false, 'expired', v_profile.email, v_profile.slug, v_token.lead_kind, v_token.lead_id; return; end if;
  update public.profile_claim_tokens t set used_at = now() where t.id = p_token;
  return query select true, null::text, v_profile.email, v_profile.slug, v_token.lead_kind, v_token.lead_id;
end;
$$;

revoke all on function public.create_profile_claim_token(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.use_profile_claim_token(uuid) from public, anon, authenticated;
grant execute on function public.create_profile_claim_token(uuid, text, uuid) to service_role;
grant execute on function public.use_profile_claim_token(uuid) to service_role;
