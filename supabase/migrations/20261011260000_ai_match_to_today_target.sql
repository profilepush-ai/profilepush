/*
# AI Match to Today: the app calls the profiles side 'hotlist'

The page sends target 'jobs' (a pasted profile, matched to jobs) or
'hotlist' (a pasted job, matched to profiles); 'hotlists' is accepted too.
*/

do $$
declare
  v_src text := pg_get_functiondef('public.ai_match_to_today(text, text, jsonb)'::regprocedure);
begin
  execute replace(v_src, $q$p_target not in ('jobs', 'hotlists')$q$, $q$p_target not in ('jobs', 'hotlist', 'hotlists')$q$);
end $$;
