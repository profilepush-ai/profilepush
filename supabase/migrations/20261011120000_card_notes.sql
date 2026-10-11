/*
# Notes on a card (the Tracker sheet's Notes column)

Tracker is a sheet: one row per application, with a Notes cell people type
into. set_card_notes saves it; cards carry it as notes.
*/

alter table public.pipeline_cards add column if not exists notes text;

create or replace function public.set_card_notes(p_id uuid, p_notes text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.pipeline_cards set notes = nullif(left(btrim(coalesce(p_notes, '')), 2000), ''), updated_at = now()
  where id = p_id and account_id = public.publisher_account_for_user(auth.uid());
end;
$$;
revoke all on function public.set_card_notes(uuid, text) from public, anon;
grant execute on function public.set_card_notes(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.pp_card_item_json(c pipeline_cards)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    -- The viewer's own picture of this post, drawn with their avatar.
    'my_visual', (select m.url from public.match_visuals_me m where m.lead_id = c.lead_id and m.user_id = auth.uid() and m.url is not null),
    'notes', c.notes,
    'card_id', c.id, 'subject_id', c.subject_id, 'lead_id', c.lead_id, 'subject_kind', c.subject_kind,
    'fit', c.fit_score, 'similarity', round(c.similarity::numeric, 3),
    'stage', c.stage, 'closed_reason', c.closed_reason,
    'viewed_at', c.viewed_at, 'saved_at', c.saved_at, 'applied_at', c.applied_at, 'added_at', c.added_at,
    'reply_in_inbox', c.conversation_id is not null and exists (
      select 1 from public.vendor_messages m where m.conversation_id = c.conversation_id and m.direction = 'inbound'),
    'how', case when c.subject_kind = 'hotlist' and exists (
      select 1 from public.external_applications ea where ea.account_id = c.account_id and ea.social_job_id = c.lead_id) then 'site' else 'email' end,
    'subject', case when c.subject_kind = 'hotlist'
      then (select jsonb_build_object(
          'id', h.id, 'title', h.role_title, 'name', h.candidate_name, 'visa', h.visa_type,
          'locations', to_jsonb(h.locations), 'years', h.years_experience, 'skills', to_jsonb(h.core_skills),
          'rate_min', h.hourly_rate_min, 'rate_max', h.hourly_rate_max, 'posted_at', coalesce(h.posted_at, h.created_at),
          'resumes', (
            select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'url', f.url, 'file_name', f.file_name, 'is_default', f.url = r.url)
              order by (f.url = r.url) desc nulls last, f.uploaded_at desc), '[]'::jsonb)
            from public.hotlist_resume_files f left join public.hotlist_resumes r on r.hotlist_id = f.hotlist_id
            where f.hotlist_id = h.id),
          'locked', 0, 'applied_today', 0)
        from public.social_hotlist h where h.id = c.subject_id)
      else (select jsonb_build_object(
          'id', j.id, 'title', j.job_title, 'location', j.location, 'skills', coalesce(j.extracted_skills, '[]'::jsonb),
          'visas', coalesce(j.extracted_visa_types, '[]'::jsonb), 'rate_min', j.extracted_hourly_rate_min,
          'rate_max', j.extracted_hourly_rate_max, 'years', j.extracted_experience_years, 'posted_at', coalesce(j.posted_at, j.created_at),
          'locked', 0, 'applied_today', 0)
        from public.social_jobs j where j.id = c.subject_id) end,
    'lead', case when c.lead_kind = 'job'
      then (select public.pp_job_card_json(j) from public.social_jobs j where j.id = c.lead_id)
      else (select public.pp_profile_card_json(h) from public.social_hotlist h where h.id = c.lead_id) end
  )
$function$;
revoke all on function public.pp_card_item_json(public.pipeline_cards) from public, anon, authenticated;
