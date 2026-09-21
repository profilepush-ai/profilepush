-- Restrict landing-page asset writes to the site owner.
--
-- The original policies were `TO authenticated ... WITH CHECK (true)` on both
-- storage.objects for the landing-assets bucket and the landing_screenshots
-- table. The only gate was in the UI — `canEdit = user?.email === '...'` in
-- PersonaLandingTemplate — which is a client-side check and enforces nothing.
--
-- Verified against production before writing this: signing up an ordinary
-- account through the public signup form and calling the storage API with its
-- token returned 200 for an upload into features/, and 201 for an upsert into
-- landing_screenshots. Any of the platform's users could therefore replace the
-- images and video on the marketing pages with anything at all. The probe
-- object and row were removed afterwards.
--
-- Reads stay open: the bucket is public and the table feeds every landing page
-- for logged-out visitors.

create or replace function public.is_landing_editor()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  -- Matches the address the UI already treats as the editor. Kept in one
  -- function so the rule can be widened to a role or an admin table later
  -- without touching six policies.
  select coalesce(
    (select lower(u.email) = 'poornapotluri27@gmail.com' from auth.users u where u.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_landing_editor() from public, anon;
grant execute on function public.is_landing_editor() to authenticated;

-- ── storage.objects, landing-assets bucket ────────────────────────────────
drop policy if exists "landing_assets_auth_insert" on storage.objects;
create policy "landing_assets_editor_insert" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'landing-assets' and public.is_landing_editor());

drop policy if exists "landing_assets_auth_update" on storage.objects;
create policy "landing_assets_editor_update" on storage.objects for update
  to authenticated
  using (bucket_id = 'landing-assets' and public.is_landing_editor())
  with check (bucket_id = 'landing-assets' and public.is_landing_editor());

drop policy if exists "landing_assets_auth_delete" on storage.objects;
create policy "landing_assets_editor_delete" on storage.objects for delete
  to authenticated
  using (bucket_id = 'landing-assets' and public.is_landing_editor());

-- ── landing_screenshots table ─────────────────────────────────────────────
drop policy if exists "auth_insert_landing_screenshots" on public.landing_screenshots;
create policy "editor_insert_landing_screenshots" on public.landing_screenshots for insert
  to authenticated
  with check (public.is_landing_editor());

drop policy if exists "auth_update_landing_screenshots" on public.landing_screenshots;
create policy "editor_update_landing_screenshots" on public.landing_screenshots for update
  to authenticated
  using (public.is_landing_editor())
  with check (public.is_landing_editor());

-- Delete had no policy at all, which meant no one could delete through the
-- API. Now the editor can, which is needed to retire an asset.
drop policy if exists "editor_delete_landing_screenshots" on public.landing_screenshots;
create policy "editor_delete_landing_screenshots" on public.landing_screenshots for delete
  to authenticated
  using (public.is_landing_editor());
