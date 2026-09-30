-- Admin > Lists > Imported: email lists gathered elsewhere (CSV files),
-- stored once per address with every file it appeared in, and exported with
-- the same rules as the other lists: ProfilePush users optional, unsubscribed
-- people never.
create table if not exists public.imported_email_contacts (
  email text primary key,
  sources text[] not null default '{}',
  first_imported_at timestamptz not null default now(),
  last_imported_at timestamptz not null default now(),
  constraint imported_email_contacts_email_check check (email = lower(trim(email)) and email like '%_@_%._%')
);

alter table public.imported_email_contacts enable row level security;
revoke all on public.imported_email_contacts from anon, authenticated;
grant select, insert, update, delete on public.imported_email_contacts to service_role;

-- Adds addresses under one source name; an address already present gains the
-- source. Returns how many were new and how many were already there.
create or replace function public.admin_import_email_contacts(p_source text, p_emails text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := left(coalesce(nullif(trim(p_source), ''), 'import'), 80);
  v_new integer;
  v_total integer;
begin
  with incoming as (
    select distinct lower(trim(e)) as email
    from unnest(coalesce(p_emails, '{}')) e
    where lower(trim(e)) ~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$'
  ),
  upserted as (
    insert into public.imported_email_contacts (email, sources)
    select i.email, array[v_source] from incoming i
    on conflict (email) do update set
      sources = case when v_source = any(imported_email_contacts.sources) then imported_email_contacts.sources
                     else imported_email_contacts.sources || v_source end,
      last_imported_at = now()
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted)::integer, count(*)::integer into v_new, v_total from upserted;
  return jsonb_build_object('source', v_source, 'received', coalesce(array_length(p_emails, 1), 0), 'valid', v_total, 'new', v_new, 'already_there', v_total - v_new);
end;
$$;

revoke all on function public.admin_import_email_contacts(text, text[]) from public, anon, authenticated;
grant execute on function public.admin_import_email_contacts(text, text[]) to service_role;

-- The imported list, with names and companies filled from our profiles where
-- the address is known, and the same joined / unsubscribed rules.
create or replace function public.admin_imported_list(p_unjoined_only boolean default true)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  with flagged as (
    select c.email, c.sources, p.display_name, p.company_name,
      (exists (select 1 from auth.users u where lower(trim(u.email)) = c.email)
        or coalesce(p.claimed_account_id is not null, false)) as joined
    from public.imported_email_contacts c
    left join public.publisher_profiles p on p.email = c.email
    where not coalesce(p.email_opted_out, false)
      and not exists (select 1 from public.market_stats_email_sends m where lower(trim(m.email)) = c.email and m.unsubscribed)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'email', f.email,
      'name', coalesce(f.display_name, ''),
      'phone', '',
      'company', coalesce(f.company_name, ''),
      'posts', 0,
      'last_posted', '',
      'joined', f.joined,
      'sources', array_to_string(f.sources, ', ')
    ) order by f.email), '[]'::jsonb)
  from flagged f
  where not p_unjoined_only or not f.joined
$$;

revoke all on function public.admin_imported_list(boolean) from public, anon, authenticated;
grant execute on function public.admin_imported_list(boolean) to service_role;
