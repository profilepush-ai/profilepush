update public.radar_match_hotlist matches
set score_breakdown = coalesce(matches.score_breakdown, '{}'::jsonb) || jsonb_build_object(
  'hotlist_source', jsonb_build_object(
    'consultant_count', hotlist.consultant_count,
    'post_scope', hotlist.post_scope,
    'candidate_index', hotlist.candidate_index
  )
)
from public.social_hotlist hotlist
where hotlist.id = matches.hotlist_id;