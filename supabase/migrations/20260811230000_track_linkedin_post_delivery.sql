alter table public.linkedin_groups_posts
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_error text;

alter table public.linkedin_keyword_posts
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_error text;

update public.linkedin_groups_posts
set delivery_status = 'legacy'
where delivery_status = 'pending';

update public.linkedin_keyword_posts
set delivery_status = 'legacy'
where delivery_status = 'pending';

alter table public.linkedin_groups_posts
  add constraint linkedin_groups_posts_delivery_status_check
  check (delivery_status in ('legacy', 'pending', 'delivered', 'not_selected', 'failed')),
  add constraint linkedin_groups_posts_delivery_attempts_check
  check (delivery_attempts >= 0);

alter table public.linkedin_keyword_posts
  add constraint linkedin_keyword_posts_delivery_status_check
  check (delivery_status in ('legacy', 'pending', 'delivered', 'not_selected', 'failed')),
  add constraint linkedin_keyword_posts_delivery_attempts_check
  check (delivery_attempts >= 0);

create index if not exists idx_linkedin_groups_posts_delivery_status
  on public.linkedin_groups_posts (delivery_status, last_seen_at desc);

create index if not exists idx_linkedin_keyword_posts_delivery_status
  on public.linkedin_keyword_posts (delivery_status, last_seen_at desc);

create or replace function public.mark_linkedin_group_posts_delivery(
  p_source_post_ids text[],
  p_status text,
  p_error text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if p_status not in ('pending', 'delivered', 'not_selected', 'failed') then
    raise exception 'Invalid delivery status: %', p_status;
  end if;

  update public.linkedin_groups_posts
  set
    delivery_status = p_status,
    delivery_attempts = delivery_attempts + case when p_status in ('delivered', 'failed') then 1 else 0 end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    delivery_error = case when p_status = 'failed' then left(coalesce(p_error, 'Unknown delivery failure'), 1000) else null end
  where source_post_id = any(coalesce(p_source_post_ids, '{}'::text[]))
    and (p_status = 'delivered' or delivery_status <> 'delivered');

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.mark_linkedin_keyword_posts_delivery(
  p_keyword_id uuid,
  p_source_post_ids text[],
  p_status text,
  p_error text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if p_status not in ('pending', 'delivered', 'not_selected', 'failed') then
    raise exception 'Invalid delivery status: %', p_status;
  end if;

  update public.linkedin_keyword_posts
  set
    delivery_status = p_status,
    delivery_attempts = delivery_attempts + case when p_status in ('delivered', 'failed') then 1 else 0 end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
    delivery_error = case when p_status = 'failed' then left(coalesce(p_error, 'Unknown delivery failure'), 1000) else null end
  where keyword_id = p_keyword_id
    and source_post_id = any(coalesce(p_source_post_ids, '{}'::text[]))
    and (p_status = 'delivered' or delivery_status <> 'delivered');

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.mark_linkedin_group_posts_delivery(text[], text, text) from public;
grant execute on function public.mark_linkedin_group_posts_delivery(text[], text, text) to service_role;
revoke all on function public.mark_linkedin_keyword_posts_delivery(uuid, text[], text, text) from public;
grant execute on function public.mark_linkedin_keyword_posts_delivery(uuid, text[], text, text) to service_role;