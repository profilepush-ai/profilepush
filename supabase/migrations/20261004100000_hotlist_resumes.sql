-- A consultant's resume, attached by the bench sales account that posted them
-- (Tracker column header) and sent as an attachment with AI Submit. Kept out
-- of social_hotlist on purpose: hotlist rows are readable by every signed-in
-- user, and a resume is the consultant's personal document.

create table if not exists public.hotlist_resumes (
  hotlist_id uuid primary key references public.social_hotlist(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  url text not null,
  file_name text not null,
  uploaded_at timestamptz not null default now()
);
alter table public.hotlist_resumes enable row level security;
drop policy if exists hotlist_resumes_select on public.hotlist_resumes;
create policy hotlist_resumes_select on public.hotlist_resumes for select to authenticated
  using (account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active'));

create or replace function public.set_hotlist_resume(p_hotlist_id uuid, p_url text, p_file_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  select h.created_by_account_id into v_account
  from public.social_hotlist h
  where h.id = p_hotlist_id
    and h.created_by_account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active');
  if v_account is null then raise exception 'Not your consultant'; end if;
  if p_url is null or p_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/resumes/' then raise exception 'Invalid resume link'; end if;
  insert into public.hotlist_resumes (hotlist_id, account_id, url, file_name, uploaded_at)
  values (p_hotlist_id, v_account, p_url, left(coalesce(nullif(trim(p_file_name), ''), 'resume.pdf'), 200), now())
  on conflict (hotlist_id) do update set url = excluded.url, file_name = excluded.file_name, uploaded_at = now(), account_id = excluded.account_id;
end;
$$;

create or replace function public.remove_hotlist_resume(p_hotlist_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.hotlist_resumes r
  where r.hotlist_id = p_hotlist_id
    and r.account_id in (select am.account_id from public.account_members am where am.user_id = auth.uid() and am.status = 'active');
$$;

revoke all on function public.set_hotlist_resume(uuid, text, text) from public, anon;
revoke all on function public.remove_hotlist_resume(uuid) from public, anon;
grant execute on function public.set_hotlist_resume(uuid, text, text) to authenticated;
grant execute on function public.remove_hotlist_resume(uuid) to authenticated;
