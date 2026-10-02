-- Cache of whether an email domain can receive mail (has an MX record, or an
-- address record as the fallback mail host). The email worker checks before
-- every email to someone who isn't a user, so addresses with a typo'd or
-- glued-on ending ("techmellousa.comkey", "worknovasllc.om") or a domain that
-- no longer exists are skipped instead of bouncing. Rechecked after 30 days.
create table if not exists public.email_domain_checks (
  domain text primary key,
  accepts_mail boolean not null,
  checked_at timestamptz not null default now()
);

alter table public.email_domain_checks enable row level security;
revoke all on public.email_domain_checks from public, anon, authenticated;
grant select, insert, update on public.email_domain_checks to service_role;
