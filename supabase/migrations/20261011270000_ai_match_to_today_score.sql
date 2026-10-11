/*
# AI Match to Today: scores are out of 10

AI Match scores each result 1 to 10; Today's match score is a percentage, so
a 9 becomes 90%.
*/

do $$
declare
  v_src text := pg_get_functiondef('public.ai_match_to_today(text, text, jsonb)'::regprocedure);
begin
  execute replace(v_src,
    $q$least(100, greatest(0, round(coalesce((e->>'ai_score')::numeric, 0))))::integer$q$,
    $q$least(100, greatest(0, round(coalesce((e->>'ai_score')::numeric, 0) * case when coalesce((e->>'ai_score')::numeric, 0) <= 10 then 10 else 1 end)))::integer$q$);
end $$;
