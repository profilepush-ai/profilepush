-- Website Modernization hosting: the sites themselves, their form
-- submissions, résumé storage, and claiming a demo.
--
-- A website starts as a demo (account_id null) that we build from a firm's
-- existing site and send them. It's served by the website-host Worker at
-- <slug>.<sites domain>, with a demo banner and noindex. The firm claims it
-- from /claim/<claim_token>: paying for the website plan (or using an active
-- plan with no site yet) attaches it to their account and makes it live.
--
-- Only the people we pitched can claim: their email must be in claim_emails,
-- or on claim_domain (the firm's own domain). Otherwise anyone with the demo
-- link could pay to take over another firm's site.

create table if not exists public.websites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (char_length(name) between 1 and 200),
  source_url text,
  html text not null check (octet_length(html) <= 2000000),
  account_id uuid references public.accounts(id) on delete set null,
  status text not null default 'demo' check (status in ('demo', 'live')),
  claim_token text not null unique default encode(gen_random_bytes(18), 'hex'),
  claim_domain text check (claim_domain is null or claim_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  claim_emails text[] not null default '{}',
  demo_expires_at timestamptz default (now() + interval '30 days'),
  claimed_at timestamptz,
  custom_domain text unique check (custom_domain is null or custom_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  notify_emails text[] not null default '{}',
  demo_request_id uuid references public.website_demo_requests(id) on delete set null
);

create index if not exists websites_account_idx on public.websites (account_id);

create table if not exists public.website_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  website_id uuid not null references public.websites(id) on delete cascade,
  kind text not null check (kind in ('candidate', 'partner', 'contact')),
  name text,
  email text,
  phone text,
  data jsonb not null default '{}'::jsonb,
  resume_path text,
  resume_filename text,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  ip_country text
);

create index if not exists website_submissions_site_idx on public.website_submissions (website_id, created_at desc);

-- Orders can carry the demo being claimed.
alter table public.website_plan_orders
  add column if not exists website_id uuid references public.websites(id) on delete set null;

-- ── Access ────────────────────────────────────────────────────────────────
-- Members read their account's sites and submissions, and move submissions
-- between statuses. Everything else (creating sites, the html, claiming) goes
-- through the service role or the security-definer functions below.

alter table public.websites enable row level security;
alter table public.website_submissions enable row level security;

revoke all on public.websites from public, anon, authenticated;
revoke all on public.website_submissions from public, anon, authenticated;
grant all on public.websites to service_role;
grant all on public.website_submissions to service_role;

grant select (id, created_at, slug, name, source_url, account_id, status, claimed_at, custom_domain, notify_emails)
  on public.websites to authenticated;
grant select on public.website_submissions to authenticated;
grant update (status) on public.website_submissions to authenticated;

drop policy if exists "members_read_own_websites" on public.websites;
create policy "members_read_own_websites" on public.websites
  for select to authenticated
  using (account_id in (
    select m.account_id from public.account_members m where m.user_id = auth.uid() and m.status = 'active'
  ));

drop policy if exists "members_read_own_submissions" on public.website_submissions;
create policy "members_read_own_submissions" on public.website_submissions
  for select to authenticated
  using (website_id in (
    select w.id from public.websites w
    join public.account_members m on m.account_id = w.account_id
    where m.user_id = auth.uid() and m.status = 'active'
  ));

drop policy if exists "members_update_own_submissions" on public.website_submissions;
create policy "members_update_own_submissions" on public.website_submissions
  for update to authenticated
  using (website_id in (
    select w.id from public.websites w
    join public.account_members m on m.account_id = w.account_id
    where m.user_id = auth.uid() and m.status = 'active'
  ))
  with check (true);

-- Résumés: private bucket, one folder per website. The Worker uploads with
-- the service role; members of the owning account can read (signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('website-resumes', 'website-resumes', false, 10485760, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
on conflict (id) do nothing;

drop policy if exists "members_read_website_resumes" on storage.objects;
create policy "members_read_website_resumes" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'website-resumes'
    and (storage.foldername(name))[1] in (
      select w.id::text from public.websites w
      join public.account_members m on m.account_id = w.account_id
      where m.user_id = auth.uid() and m.status = 'active'
    )
  );

-- ── Serving (Worker, service role) ─────────────────────────────────────────
-- One site by slug or custom domain, with whether it's live (claimed, and
-- the owner's plan running) and who gets enquiry alerts: notify_emails, or
-- else the account's active members.
create or replace function public.website_for_request(p_slug text, p_host text)
returns table (
  id uuid, slug text, name text, html text, status text, live boolean,
  claimed boolean, claim_token text, demo_expired boolean, alert_emails text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.slug, w.name, w.html, w.status,
    (w.status = 'live' and w.account_id is not null and coalesce(a.website_plan_expires_at > now(), false)),
    w.account_id is not null,
    w.claim_token,
    (w.account_id is null and w.demo_expires_at is not null and w.demo_expires_at < now()),
    case
      when cardinality(w.notify_emails) > 0 then w.notify_emails
      else coalesce((
        select array_agg(u.email::text) from public.account_members m
        join auth.users u on u.id = m.user_id
        where m.account_id = w.account_id and m.status = 'active' and u.email is not null
      ), '{}')
    end
  from public.websites w
  left join public.accounts a on a.id = w.account_id
  where (p_slug is not null and w.slug = lower(p_slug))
     or (p_host is not null and w.custom_domain = regexp_replace(lower(p_host), '^www\.', ''))
  limit 1
$$;

revoke all on function public.website_for_request(text, text) from public, anon, authenticated;
grant execute on function public.website_for_request(text, text) to service_role;

-- ── Claiming ──────────────────────────────────────────────────────────────
-- Which website a user may claim with this token. Raises a readable error
-- when they can't; the message reaches the claim page.
create or replace function public.website_claim_target(p_token text, p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_site public.websites%rowtype;
  v_email text;
begin
  select * into v_site from public.websites w where w.claim_token = p_token;
  if not found then raise exception 'This claim link is not valid.'; end if;
  if v_site.account_id is not null then raise exception 'This website has already been claimed.'; end if;
  if v_site.demo_expires_at is not null and v_site.demo_expires_at < now() then
    raise exception 'This demo has expired. Contact us and we will renew it.';
  end if;

  select lower(u.email::text) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then raise exception 'Sign in to claim this website.'; end if;
  if not (
    v_email = any (select lower(e) from unnest(v_site.claim_emails) e)
    or (v_site.claim_domain is not null and split_part(v_email, '@', 2) = v_site.claim_domain)
  ) then
    raise exception 'Sign in with your work email% to claim this website.',
      coalesce(' (@' || v_site.claim_domain || ')', '');
  end if;
  return v_site.id;
end;
$$;

revoke all on function public.website_claim_target(text, uuid) from public, anon, authenticated;
grant execute on function public.website_claim_target(text, uuid) to service_role;

-- Attaches a demo to an account and makes it live. Only if still unclaimed.
create or replace function public.attach_website_to_account(p_website_id uuid, p_account_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.websites w
  set account_id = p_account_id, status = 'live', claimed_at = now(), updated_at = now(), demo_expires_at = null
  where w.id = p_website_id and w.account_id is null;
  return found;
end;
$$;

revoke all on function public.attach_website_to_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.attach_website_to_account(uuid, uuid) to service_role;

-- For the claim page (no sign-in needed): what is being claimed.
create or replace function public.get_claimable_website(p_token text)
returns table (name text, slug text, source_url text, claimed boolean, expired boolean, claim_domain text)
language sql
stable
security definer
set search_path = public
as $$
  select w.name, w.slug, w.source_url, w.account_id is not null,
         (w.account_id is null and w.demo_expires_at is not null and w.demo_expires_at < now()),
         w.claim_domain
  from public.websites w
  where w.claim_token = p_token
$$;

revoke all on function public.get_claimable_website(text) from public;
grant execute on function public.get_claimable_website(text) to anon, authenticated;

-- Claim without paying: the account already has a running plan and no site.
create or replace function public.claim_website_with_active_plan(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid := public.publisher_account_for_user(auth.uid());
  v_site_id uuid;
begin
  if v_account_id is null then raise exception 'Account not found.'; end if;
  v_site_id := public.website_claim_target(p_token, auth.uid());
  if not exists (select 1 from public.accounts a where a.id = v_account_id and a.website_plan_expires_at > now()) then
    raise exception 'Activate the website plan to claim this website.';
  end if;
  if exists (select 1 from public.websites w where w.account_id = v_account_id) then
    raise exception 'Your plan already has a website. Contact us to add another.';
  end if;
  if not public.attach_website_to_account(v_site_id, v_account_id) then
    raise exception 'This website has already been claimed.';
  end if;
  return v_site_id;
end;
$$;

revoke all on function public.claim_website_with_active_plan(text) from public, anon;
grant execute on function public.claim_website_with_active_plan(text) to authenticated;

-- Same as before, plus: an order that carries a website claims it.
create or replace function public.apply_website_plan_order(p_razorpay_order_id text, p_razorpay_payment_id text)
returns table (applied boolean, account_id uuid, plan_expires_at timestamptz, credits integer, new_balance numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_order public.website_plan_orders%rowtype;
  v_expires timestamptz;
  v_balance numeric;
begin
  update public.website_plan_orders o
  set status = 'paid', razorpay_payment_id = p_razorpay_payment_id, paid_at = now()
  where o.razorpay_order_id = p_razorpay_order_id and o.status = 'created'
  returning o.* into v_order;

  if not found then
    select o.* into v_order from public.website_plan_orders o where o.razorpay_order_id = p_razorpay_order_id;
    select a.credits_balance into v_balance from public.accounts a where a.id = v_order.account_id;
    return query select false, v_order.account_id, v_order.plan_expires_at, v_order.bonus_credits, v_balance;
    return;
  end if;

  update public.accounts a
  set website_plan_expires_at = greatest(coalesce(a.website_plan_expires_at, now()), now()) + make_interval(months => v_order.term_months),
      credits_balance = coalesce(a.credits_balance, 0) + v_order.bonus_credits,
      is_trial = false
  where a.id = v_order.account_id
  returning a.website_plan_expires_at, a.credits_balance into v_expires, v_balance;

  update public.website_plan_orders o set plan_expires_at = v_expires where o.id = v_order.id;

  if v_order.website_id is not null then
    perform public.attach_website_to_account(v_order.website_id, v_order.account_id);
  end if;

  if v_order.bonus_credits > 0 then
    insert into public.credit_transactions (account_id, user_id, type, amount, description)
    values (
      v_order.account_id, v_order.user_id, 'grant', v_order.bonus_credits,
      'Website plan: ' || v_order.bonus_credits || ' credits included (₹'
        || (v_order.amount_inr_paise / 100) || ', ' || coalesce(p_razorpay_payment_id, 'payment') || ')'
    );
  end if;

  return query select true, v_order.account_id, v_expires, v_order.bonus_credits, v_balance;
end;
$$;

revoke all on function public.apply_website_plan_order(text, text) from public, anon, authenticated;
grant execute on function public.apply_website_plan_order(text, text) to service_role;
