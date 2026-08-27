-- Supabase's platform-level gateway requires a valid Supabase-issued JWT in
-- Authorization before a request even reaches an edge function's own code —
-- the previous version of this trigger sent the webhook token there
-- directly, which the gateway rejected as "Invalid JWT" before
-- notify-new-signup ever ran (confirmed live: every call failed with
-- UNAUTHORIZED_INVALID_JWT_FORMAT). Same fix as notify-daily-digest already
-- uses: send the anon key (public by design, safe to inline — it's the same
-- value already embedded in the shipped frontend bundle) to satisfy the
-- gateway, and move the actual webhook token into the JSON body instead,
-- checked by the function itself.
create or replace function public.notify_new_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_worker_url text := 'https://nhwqcqzvotgdngtxulwi.supabase.co/functions/v1/notify-new-signup';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5od3FjcXp2b3RnZG5ndHh1bHdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjY3NDQsImV4cCI6MjA5NjQ0Mjc0NH0.DCPM9hZwqEsfmStT1beaUtp3P-uDVkCZL8xv0ZFpCss';
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
        'token', v_webhook_token,
        'account_id', NEW.id,
        'account_name', NEW.name,
        'owner_id', NEW.owner_id,
        'created_at', NEW.created_at
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key,
        'apikey', v_anon_key
      ),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'Failed to notify new signup for account %: %', NEW.id, SQLERRM;
  end;

  return NEW;
end;
$$;
