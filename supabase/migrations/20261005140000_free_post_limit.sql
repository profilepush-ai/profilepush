-- Free plan: up to 3 open posts (consultants and requirements together) per
-- account. Each consultant or requirement counts once, which is also one
-- Tracker column. Closing one frees a slot. Accounts that have paid (Pro, or
-- any credit pack: account_has_paid) are unlimited. Accounts already over the
-- limit keep what they have; they just can't open more until they're under it.
--
-- Enforced by a trigger on both tables, so every path obeys it: the post form,
-- AI Match's auto-post, bulk paste and reopening a closed post.
create or replace function public.enforce_free_post_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open integer;
begin
  if new.post_source is distinct from 'user_post' or new.created_by_account_id is null then return new; end if;
  if coalesce(new.post_status, 'open') <> 'open' or new.hidden_at is not null then return new; end if;
  -- Updates only matter when they reopen a closed post.
  if tg_op = 'UPDATE' and coalesce(old.post_status, 'open') = 'open' and old.hidden_at is null then return new; end if;
  if public.account_has_paid(new.created_by_account_id) then return new; end if;

  select
    (select count(*) from public.social_hotlist h
      where h.created_by_account_id = new.created_by_account_id and h.post_source = 'user_post'
        and coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null and h.id <> new.id)
  + (select count(*) from public.social_jobs j
      where j.created_by_account_id = new.created_by_account_id and j.post_source = 'user_post'
        and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null and j.id <> new.id)
  into v_open;

  if v_open >= 3 then
    raise exception 'Free plan: up to 3 open consultants or requirements. Close one, or buy credits to add more.'
      using hint = 'free_plan_limit';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_free_post_limit() from public, anon, authenticated;

drop trigger if exists enforce_free_post_limit on public.social_hotlist;
create trigger enforce_free_post_limit
  before insert or update of post_status, hidden_at on public.social_hotlist
  for each row execute function public.enforce_free_post_limit();

drop trigger if exists enforce_free_post_limit on public.social_jobs;
create trigger enforce_free_post_limit
  before insert or update of post_status, hidden_at on public.social_jobs
  for each row execute function public.enforce_free_post_limit();

-- For the app: how many more posts this account can open (null = unlimited).
create or replace function public.my_open_post_allowance()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with acc as (select public.publisher_account_for_user(auth.uid()) as id)
  select case when public.account_has_paid(acc.id) then null else greatest(0, 3 - (
    (select count(*) from public.social_hotlist h where h.created_by_account_id = acc.id and h.post_source = 'user_post' and coalesce(h.post_status, 'open') = 'open' and h.hidden_at is null)
  + (select count(*) from public.social_jobs j where j.created_by_account_id = acc.id and j.post_source = 'user_post' and coalesce(j.post_status, 'open') = 'open' and j.hidden_at is null)
  ))::integer end
  from acc;
$$;
revoke all on function public.my_open_post_allowance() from public, anon;
grant execute on function public.my_open_post_allowance() to authenticated;
