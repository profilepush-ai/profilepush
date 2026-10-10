/*
# Ask the poster (rate, visa, location)

When a post leaves out the rate, the visa or the location, a user can tap Ask.
ProfilePush then emails the poster (when the post has an email) that this user
is interested and asked, with the user's name and email so the poster can
reply to them directly: an interested lead for the poster, and an answer for
the user. Emails go only when someone asks, at most one per post and question
every 3 days; later askers are recorded and counted in the next email.

post_questions: one row per account, post and question. Written by the
ask-poster edge function (service role); each account reads its own.
*/

create table if not exists public.post_questions (
  id uuid primary key default gen_random_uuid(),
  lead_kind text not null check (lead_kind in ('job', 'hotlist')),
  lead_id uuid not null,
  question text not null check (question in ('rate', 'visa', 'location')),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid,
  created_at timestamptz not null default now(),
  emailed_at timestamptz,
  unique (lead_id, question, account_id)
);
create index if not exists post_questions_lead_idx on public.post_questions (lead_id, question, created_at desc);
create index if not exists post_questions_account_idx on public.post_questions (account_id, created_at desc);
alter table public.post_questions enable row level security;
drop policy if exists post_questions_select on public.post_questions;
create policy post_questions_select on public.post_questions for select to authenticated
  using (account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active'));
