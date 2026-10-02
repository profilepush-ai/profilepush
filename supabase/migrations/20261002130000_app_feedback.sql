-- Ratings and feedback from users, asked right after a successful AI Submit.
--
-- app_feedback: one row per answer (1-5 stars, optional comment, whether we
-- may show the comment publicly). feedback_prompt_state decides when to ask:
-- not again for 90 days after a rating, or 14 days after closing the card.
-- get_public_rating feeds the landing page's rating block and its
-- SoftwareApplication schema: real ratings only, comments only with consent,
-- and nothing until there are at least 10 ratings.

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  can_publish boolean not null default false,
  context text,
  platform text,
  persona text
);

create index if not exists app_feedback_created_at_idx on public.app_feedback (created_at desc);

create table if not exists public.feedback_prompt_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_shown_at timestamptz,
  last_dismissed_at timestamptz,
  last_rated_at timestamptz
);

alter table public.app_feedback enable row level security;
alter table public.feedback_prompt_state enable row level security;
revoke all on public.app_feedback, public.feedback_prompt_state from public, anon, authenticated;
grant select, insert, update on public.app_feedback, public.feedback_prompt_state to service_role;

-- Should the card show now? Records that it did.
create or replace function public.claim_feedback_prompt()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.feedback_prompt_state%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into v_state from public.feedback_prompt_state where user_id = auth.uid();
  if found and (
    (v_state.last_rated_at is not null and v_state.last_rated_at > now() - interval '90 days')
    or (v_state.last_dismissed_at is not null and v_state.last_dismissed_at > now() - interval '14 days')
    or (v_state.last_shown_at is not null and v_state.last_shown_at > now() - interval '12 hours')
  ) then
    return false;
  end if;
  insert into public.feedback_prompt_state (user_id, last_shown_at) values (auth.uid(), now())
  on conflict (user_id) do update set last_shown_at = now();
  return true;
end;
$$;

create or replace function public.submit_app_feedback(
  p_rating integer,
  p_comment text default null,
  p_can_publish boolean default false,
  p_context text default null,
  p_platform text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid := public.publisher_account_for_user(auth.uid());
begin
  if auth.uid() is null then raise exception 'Sign in to leave feedback'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Rating must be 1 to 5'; end if;
  insert into public.app_feedback (user_id, account_id, rating, comment, can_publish, context, platform, persona)
  values (
    auth.uid(), v_account, p_rating,
    nullif(left(trim(coalesce(p_comment, '')), 2000), ''),
    coalesce(p_can_publish, false),
    left(p_context, 40), left(p_platform, 20),
    (select a.active_persona::text from public.accounts a where a.id = v_account)
  );
  insert into public.feedback_prompt_state (user_id, last_rated_at) values (auth.uid(), now())
  on conflict (user_id) do update set last_rated_at = now();
end;
$$;

create or replace function public.dismiss_feedback_prompt()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.feedback_prompt_state (user_id, last_dismissed_at)
  select auth.uid(), now() where auth.uid() is not null
  on conflict (user_id) do update set last_dismissed_at = now();
$$;

revoke all on function public.claim_feedback_prompt() from public, anon;
revoke all on function public.submit_app_feedback(integer, text, boolean, text, text) from public, anon;
revoke all on function public.dismiss_feedback_prompt() from public, anon;
grant execute on function public.claim_feedback_prompt() to authenticated;
grant execute on function public.submit_app_feedback(integer, text, boolean, text, text) to authenticated;
grant execute on function public.dismiss_feedback_prompt() to authenticated;

-- For the landing page. Average and count of every rating; up to 3 recent
-- 4-5 star comments their authors agreed to show, credited by first name and
-- company. Empty until there are 10 ratings.
create or replace function public.get_public_rating()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  with stats as (
    select count(*)::integer as n, round(avg(rating)::numeric, 1) as avg from public.app_feedback
  )
  select case when (select n from stats) < 10 then jsonb_build_object('count', (select n from stats))
  else jsonb_build_object(
    'count', (select n from stats),
    'average', (select avg from stats),
    'testimonials', coalesce((
      select jsonb_agg(t order by t.created_at desc) from (
        select f.created_at, f.rating, f.comment,
          nullif(initcap(split_part(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), ' ', 1)), '') as name,
          nullif(trim(a.name), '') as company,
          f.persona
        from public.app_feedback f
        join auth.users u on u.id = f.user_id
        left join public.accounts a on a.id = f.account_id
        where f.can_publish and f.rating >= 4 and length(coalesce(f.comment, '')) >= 20
        order by f.created_at desc
        limit 3
      ) t
    ), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.get_public_rating() from public;
grant execute on function public.get_public_rating() to anon, authenticated;

-- For Admin > Feedback.
create or replace function public.admin_feedback_report()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'count', (select count(*) from public.app_feedback),
    'average', (select round(avg(rating)::numeric, 2) from public.app_feedback),
    'distribution', coalesce((select jsonb_object_agg(rating, n) from (select rating, count(*) n from public.app_feedback group by rating) d), '{}'::jsonb),
    'shown', (select count(*) from public.feedback_prompt_state where last_shown_at is not null),
    'dismissed', (select count(*) from public.feedback_prompt_state where last_dismissed_at is not null),
    'rows', coalesce((
      select jsonb_agg(r order by r.created_at desc) from (
        select f.id, f.created_at, f.rating, f.comment, f.can_publish, f.context, f.platform, f.persona,
          u.email::text as email,
          coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), '')) as name,
          a.name as company
        from public.app_feedback f
        join auth.users u on u.id = f.user_id
        left join public.accounts a on a.id = f.account_id
        order by f.created_at desc
        limit 500
      ) r
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_feedback_report() from public, anon, authenticated;
grant execute on function public.admin_feedback_report() to service_role;
