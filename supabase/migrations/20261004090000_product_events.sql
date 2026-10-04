-- Product events: what people do on a page, beyond time on site. Added to
-- measure the vendor funnel (AI Request started / drafted / sent / dismissed,
-- where new vendors land), which time-only activity could not show.

create table if not exists public.product_events (
  id bigserial primary key,
  account_id uuid references public.accounts(id) on delete cascade,
  user_id uuid,
  event text not null check (length(event) <= 60),
  props jsonb not null default '{}'::jsonb,
  path text,
  created_at timestamptz not null default now()
);
create index if not exists product_events_event_created_idx on public.product_events (event, created_at desc);
create index if not exists product_events_account_idx on public.product_events (account_id, created_at desc);
alter table public.product_events enable row level security;
-- No direct access: written through track_event, read by admins with the service role.

create or replace function public.track_event(p_event text, p_props jsonb default '{}'::jsonb, p_path text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  if auth.uid() is null or coalesce(trim(p_event), '') = '' then return; end if;
  select am.account_id into v_account
  from public.account_members am
  where am.user_id = auth.uid() and am.status = 'active'
  order by am.created_at
  limit 1;
  insert into public.product_events (account_id, user_id, event, props, path)
  values (v_account, auth.uid(), left(trim(p_event), 60),
          case when pg_column_size(p_props) <= 4000 then coalesce(p_props, '{}'::jsonb) else '{}'::jsonb end,
          left(p_path, 200));
end;
$$;
revoke all on function public.track_event(text, jsonb, text) from public, anon;
grant execute on function public.track_event(text, jsonb, text) to authenticated;
