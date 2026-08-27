-- Internal notification: alert profilepush.ai@gmail.com the moment a new
-- account is created, via the same GMass-connected mailbox
-- (profilepush-email-notifications' /send endpoint) already used for the
-- daily digest and market-stats outreach. A DB trigger on accounts (not a
-- client-side call from SignUp.tsx/GoogleSignInButton.tsx) is deliberate:
-- it fires exactly once per real account, regardless of which signup path
-- created it (email/password, web Google, native Google) or whether the
-- client's own JS finishes running — a closed tab or blocked request can't
-- silently drop the notification the way a fire-and-forget client call can.
--
-- Same webhook-token-in-a-table pattern as
-- 20260814099000_fix_market_stats_outreach_config.sql, for the same reason:
-- this project's postgres role can't `alter database ... set app.xxx`
-- (confirmed there, and independently confirmed again here — app.supabase_url/
-- app.service_role_key are unset), so the older crons that reference those
-- settings directly cannot be the model to follow.
create table if not exists public.signup_notify_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.signup_notify_config enable row level security;
grant select on public.signup_notify_config to service_role;
-- No grants to authenticated/anon: holds the trigger's shared secret token.
-- SECURITY DEFINER trigger functions owned by the table owner bypass RLS by
-- default, so they can still read this table.

create or replace function public.notify_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_worker_url text := 'https://nhwqcqzvotgdngtxulwi.supabase.co/functions/v1/notify-new-signup';
  v_webhook_token text;
begin
  select value into v_webhook_token from public.signup_notify_config where key = 'webhook_token';

  if coalesce(v_webhook_token, '') = '' then
    raise warning 'New-signup notification skipped: missing signup_notify_config.webhook_token';
    return NEW;
  end if;

  begin
    perform net.http_post(
      url := v_worker_url,
      body := jsonb_build_object(
        'account_id', NEW.id,
        'account_name', NEW.name,
        'owner_id', NEW.owner_id,
        'created_at', NEW.created_at
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_webhook_token
      ),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'Failed to notify new signup for account %: %', NEW.id, SQLERRM;
  end;

  return NEW;
end;
$$;

create trigger accounts_notify_new_signup
after insert on public.accounts
for each row execute function public.notify_new_signup();
