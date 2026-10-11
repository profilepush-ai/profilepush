/*
# Which persona a job's picture shows

job-visual picks the next picture's persona from those not used lately, so
pictures that sit near each other in Today don't show the same kind of face.
*/

alter table public.job_visuals add column if not exists persona text;
