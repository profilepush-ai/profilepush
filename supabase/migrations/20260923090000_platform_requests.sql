-- Things users ask for that we have not built yet.
--
-- The first is Outlook sending. Bulk AI Submit and AI Invite both send through
-- the user's own connected Gmail, which leaves everyone on Microsoft with no
-- way to use the feature at all. Building Graph sending is a real project —
-- a separate OAuth app, separate consent, a different send API — so this
-- records demand first and lets the size of the queue decide whether it is
-- worth it, rather than guessing.
--
-- Deliberately generic: the next unbuilt thing someone asks for gets a new
-- request_type, not a new table.

create table if not exists public.platform_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  request_type text not null check (request_type in ('outlook_send')),
  note text,
  -- Admin-side state. 'new' until someone looks at it.
  status text not null default 'new' check (status in ('new', 'seen', 'done', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One standing request per account per thing. Asking twice is the same
  -- signal as asking once, and a duplicate row would inflate the count the
  -- decision gets made on.
  unique (account_id, request_type)
);

create index if not exists platform_requests_status_idx
  on public.platform_requests (status, created_at desc);

alter table public.platform_requests enable row level security;

-- Users may register their own request and see it, nothing more. Reading is
-- scoped so nobody can count another company's interest in a feature.
create policy "members_insert_own_platform_request" on public.platform_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.account_members am
      where am.account_id = platform_requests.account_id
        and am.user_id = auth.uid()
        and am.status = 'active'
    )
  );

create policy "members_read_own_platform_request" on public.platform_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.account_members am
      where am.account_id = platform_requests.account_id
        and am.user_id = auth.uid()
        and am.status = 'active'
    )
  );

-- Admin reads and status changes go through the admin-notifications function
-- on the service-role key, so no policy is granted for those.
