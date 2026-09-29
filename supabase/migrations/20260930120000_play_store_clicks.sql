-- Clicks on the Google Play links, for Account Stats. One row per click;
-- account and user are recorded when the clicker is signed in.
create table if not exists public.play_store_clicks (
  id bigserial primary key,
  account_id uuid references public.accounts(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  source text not null default 'banner',
  created_at timestamptz not null default now()
);

create index if not exists play_store_clicks_created_idx on public.play_store_clicks (created_at desc);
create index if not exists play_store_clicks_account_idx on public.play_store_clicks (account_id, created_at desc);

alter table public.play_store_clicks enable row level security;
revoke all on public.play_store_clicks from anon, authenticated;
grant select, insert on public.play_store_clicks to service_role;

create or replace function public.log_play_store_click(p_source text default 'banner')
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.play_store_clicks (account_id, user_id, source)
  values (
    case when auth.uid() is not null then public.publisher_account_for_user(auth.uid()) end,
    auth.uid(),
    left(coalesce(nullif(trim(p_source), ''), 'banner'), 40)
  )
$$;

revoke all on function public.log_play_store_click(text) from public;
grant execute on function public.log_play_store_click(text) to anon, authenticated;
