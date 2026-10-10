/*
# AI Apply (the ProfilePush Apply Chrome extension)

The extension reads a career site's application form; ai-apply works out the
answers from the chosen profile (rules for names and the resume, Llama on
Cloudflare for the rest) and the extension fills them. The user reviews and
presses the site's own Apply button; we never submit.

Price: 4 credits (₹1) per application, charged once per profile and site
every 6 hours, so a form spread over several pages (Workday) is one charge.
*/

create table if not exists public.ai_apply_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null,
  subject_id uuid not null,
  origin text not null,
  url text,
  fields integer not null default 0,
  answered integer not null default 0,
  charged boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ai_apply_log_recent_idx on public.ai_apply_log (subject_id, origin, created_at desc);
alter table public.ai_apply_log enable row level security;

create or replace function public.charge_ai_apply(p_account uuid, p_user uuid, p_subject uuid, p_origin text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_price numeric := 4;
begin
  if exists (select 1 from public.ai_apply_log l where l.subject_id = p_subject and l.origin = p_origin and l.charged and l.created_at > now() - interval '6 hours') then
    return jsonb_build_object('ok', true, 'charged', false, 'balance', (select a.credits_balance from public.accounts a where a.id = p_account));
  end if;
  update public.accounts set credits_balance = round(credits_balance - v_price, 4)
  where id = p_account and credits_balance >= v_price;
  if not found then
    return jsonb_build_object('ok', false, 'charged', false, 'balance', (select a.credits_balance from public.accounts a where a.id = p_account));
  end if;
  insert into public.credit_transactions (account_id, user_id, type, amount, description)
  values (p_account, p_user, 'usage', -v_price, 'Usage: AI Apply');
  return jsonb_build_object('ok', true, 'charged', true, 'balance', (select a.credits_balance from public.accounts a where a.id = p_account));
end;
$$;
revoke all on function public.charge_ai_apply(uuid, uuid, uuid, text) from public, anon, authenticated;
