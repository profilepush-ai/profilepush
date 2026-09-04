-- Screening videos are moving from Cloudflare Stream (permanent storage,
-- billed monthly for as long as a video exists) to Cloudflare R2 (permanent
-- storage, effectively free at this volume). Stream stays in the flow only
-- transiently, for its auto-captioning capability. This migration is purely
-- additive so it can ship ahead of the Worker/frontend changes with zero
-- behavior change; video_stream_uid is dropped in a later migration once the
-- new columns are live and verified end-to-end.
alter table public.job_application_screening_turns
  add column if not exists video_r2_key text,
  add column if not exists video_content_type text;
