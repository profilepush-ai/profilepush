/*
# Refer and earn

Everyone has a link, profilepush.ai/r/<code>. When someone new signs up
through it, they get the usual 100 credits plus a 50 bonus, and the person
who shared it gets 100 credits (and a notification).

Guards: not yourself or your own account; only accounts under 7 days old;
each person can be referred once; at most 100 rewarded referrals a month
per referrer.
*/

create table if not exists public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.referral_codes enable row level security;
drop policy if exists referral_codes_own on public.referral_codes;
create policy referral_codes_own on public.referral_codes for select to authenticated using (user_id = auth.uid());

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  referrer_user_id uuid not null,
  referrer_account_id uuid not null,
  referee_user_id uuid not null unique,
  referee_account_id uuid not null,
  referrer_credits integer not null default 100,
  referee_credits integer not null default 50,
  created_at timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id, created_at desc);
alter table public.referrals enable row level security;
drop policy if exists referrals_mine on public.referrals;
create policy referrals_mine on public.referrals for select to authenticated using (referrer_user_id = auth.uid());

-- Their link (made on first ask) and how it's done.
create or replace function public.my_referral()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_user uuid := auth.uid();
  v_code text;
begin
  if v_user is null then return null; end if;
  select code into v_code from public.referral_codes where user_id = v_user;
  while v_code is null loop
    v_code := lower(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=0O1lI', ''), 1, 7));
    begin
      insert into public.referral_codes (user_id, code) values (v_user, v_code);
    exception when unique_violation then
      v_code := null;
      select code into v_code from public.referral_codes where user_id = v_user;
    end;
  end loop;
  return jsonb_build_object(
    'code', v_code,
    'joined', (select count(*) from public.referrals r where r.referrer_user_id = v_user),
    'earned', (select coalesce(sum(r.referrer_credits), 0) from public.referrals r where r.referrer_user_id = v_user));
end;
$$;
revoke all on function public.my_referral() from public, anon;
grant execute on function public.my_referral() to authenticated;

-- A new user who came through a link claims it once signed in.
create or replace function public.claim_referral(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public', 'auth' as $$
declare
  v_user uuid := auth.uid();
  v_account uuid := public.publisher_account_for_user(auth.uid());
  v_owner uuid;
  v_owner_account uuid;
  v_name text;
begin
  if v_user is null or v_account is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  select user_id into v_owner from public.referral_codes where code = lower(btrim(p_code));
  if v_owner is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if v_owner = v_user then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  v_owner_account := public.publisher_account_for_user(v_owner);
  if v_owner_account is null or v_owner_account = v_account then return jsonb_build_object('ok', false, 'reason', 'same_account'); end if;
  if not exists (select 1 from public.accounts a where a.id = v_account and a.created_at > now() - interval '7 days') then
    return jsonb_build_object('ok', false, 'reason', 'not_new');
  end if;
  if exists (select 1 from public.referrals r where r.referee_user_id = v_user) then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  if (select count(*) from public.referrals r where r.referrer_user_id = v_owner and r.created_at > now() - interval '30 days') >= 100 then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;

  insert into public.referrals (code, referrer_user_id, referrer_account_id, referee_user_id, referee_account_id)
  values (lower(btrim(p_code)), v_owner, v_owner_account, v_user, v_account);

  update public.accounts set credits_balance = coalesce(credits_balance, 0) + 50 where id = v_account;
  insert into public.credit_transactions (account_id, user_id, type, amount, description)
  values (v_account, v_user, 'grant', 50, 'Referral bonus: welcome to ProfilePush');

  update public.accounts set credits_balance = coalesce(credits_balance, 0) + 100 where id = v_owner_account;
  select coalesce(nullif(split_part(u.raw_user_meta_data->>'full_name', ' ', 1), ''), split_part(u.email, '@', 1)) into v_name from auth.users u where u.id = v_user;
  insert into public.credit_transactions (account_id, user_id, type, amount, description)
  values (v_owner_account, v_owner, 'grant', 100, 'Referral: ' || coalesce(v_name, 'someone') || ' joined with your link');
  insert into public.notifications (account_id, user_id, type, title, body, link, read)
  values (v_owner_account, v_owner, 'referral_reward', left(coalesce(v_name, 'Someone') || ' joined with your link: +100 credits', 200),
    'Thank you for sharing ProfilePush. Keep sharing to earn more.', '/settings#refer', false);

  return jsonb_build_object('ok', true, 'bonus', 50);
end;
$$;
revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;
