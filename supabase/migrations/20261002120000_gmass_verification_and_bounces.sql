-- Better addresses for email to non-users (the GMass outreach lane).
--
-- email_verifications: GMass's free verifier's answer for each address,
-- checked once before the first email. Invalid / Malformed / NoMxRecord are
-- never emailed.
--
-- email_suppressions: addresses GMass reported as bounced or blocked (its
-- webhooks call the email worker's /gmass-webhook). Never emailed again.
-- The worker also marks the address's latest GMass send as bounced, with a
-- 'Permanent' bounce_type, so admin counts it and every audience that
-- already skips hard bounces skips it too.
create table if not exists public.email_verifications (
  email text primary key,
  status text not null,
  sendable boolean not null,
  checked_at timestamptz not null default now()
);

create table if not exists public.email_suppressions (
  email text primary key,
  reason text not null,
  source text not null default 'gmass',
  created_at timestamptz not null default now()
);

-- Raw webhook calls, kept so the payload can be checked if GMass changes it.
create table if not exists public.gmass_webhook_events (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  event text,
  emails text[],
  payload jsonb
);

alter table public.email_verifications enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.gmass_webhook_events enable row level security;
revoke all on public.email_verifications, public.email_suppressions, public.gmass_webhook_events from public, anon, authenticated;
grant select, insert, update on public.email_verifications, public.email_suppressions, public.gmass_webhook_events to service_role;

-- Records a GMass bounce or block for each address: suppress it and mark its
-- latest GMass send as bounced.
create or replace function public.record_gmass_bounces(p_emails text[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_count integer := 0;
begin
  foreach v_email in array coalesce(p_emails, '{}'::text[]) loop
    v_email := lower(trim(v_email));
    continue when v_email = '' or position('@' in v_email) = 0;
    insert into public.email_suppressions (email, reason) values (v_email, p_reason)
    on conflict (email) do nothing;
    update public.email_sends s
    set bounced_at = coalesce(s.bounced_at, now()),
        bounce_type = coalesce(s.bounce_type, 'Permanent (GMass ' || p_reason || ')')
    where s.id = (
      select s2.id from public.email_sends s2
      where lower(s2.to_email) = v_email and s2.provider = 'gmass'
      order by s2.created_at desc limit 1
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.record_gmass_bounces(text[], text) from public, anon, authenticated;
grant execute on function public.record_gmass_bounces(text[], text) to service_role;
