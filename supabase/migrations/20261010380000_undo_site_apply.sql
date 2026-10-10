/*
# Undo for "Apply on their site"

Today counts tapping Apply on a career site as applied, with an Undo. This
puts the card back in New and removes the application, for the caller's own
card, within an hour of applying.
*/

create or replace function public.undo_site_apply(p_card_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  c public.pipeline_cards%rowtype;
begin
  select * into c from public.pipeline_cards
  where id = p_card_id and account_id = public.publisher_account_for_user(auth.uid());
  if not found then raise exception 'Card not found'; end if;
  if c.applied_at is null or c.applied_at < now() - interval '1 hour' then return; end if;
  delete from public.external_applications ea
  where ea.account_id = c.account_id and ea.social_job_id = c.lead_id
    and (ea.subject_id is null or ea.subject_id = c.subject_id)
    and ea.created_at > now() - interval '1 hour';
  update public.pipeline_cards
  set stage = 'new', applied_at = null, closed_reason = null, stage_changed_at = now(), updated_at = now()
  where id = p_card_id;
end;
$$;
revoke all on function public.undo_site_apply(uuid) from public, anon;
grant execute on function public.undo_site_apply(uuid) to authenticated;
