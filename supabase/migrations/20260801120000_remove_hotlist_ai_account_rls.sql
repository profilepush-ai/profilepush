drop policy if exists select_own_hotlist_ai_roles on public.hotlist_ai_roles;
drop policy if exists insert_own_hotlist_ai_roles on public.hotlist_ai_roles;
drop policy if exists update_own_hotlist_ai_roles on public.hotlist_ai_roles;
drop policy if exists delete_own_hotlist_ai_roles on public.hotlist_ai_roles;

drop policy if exists select_own_hotlist_ai_matches on public.hotlist_ai_matches;
drop policy if exists insert_own_hotlist_ai_matches on public.hotlist_ai_matches;
drop policy if exists delete_own_hotlist_ai_matches on public.hotlist_ai_matches;

create policy select_all_hotlist_ai_roles
  on public.hotlist_ai_roles
  for select
  using (true);

create policy insert_all_hotlist_ai_roles
  on public.hotlist_ai_roles
  for insert
  with check (true);

create policy update_all_hotlist_ai_roles
  on public.hotlist_ai_roles
  for update
  using (true)
  with check (true);

create policy delete_all_hotlist_ai_roles
  on public.hotlist_ai_roles
  for delete
  using (true);

create policy select_all_hotlist_ai_matches
  on public.hotlist_ai_matches
  for select
  using (true);

create policy insert_all_hotlist_ai_matches
  on public.hotlist_ai_matches
  for insert
  with check (true);

create policy delete_all_hotlist_ai_matches
  on public.hotlist_ai_matches
  for delete
  using (true);
