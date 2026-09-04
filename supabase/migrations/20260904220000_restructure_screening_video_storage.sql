-- Screening moves from "one video file per question" to "one continuous
-- video for the whole interview" (still adaptive — each question is
-- generated from a fast Whisper transcript of the prior answer, captured
-- before the final combined video exists). Video is now one-per-application,
-- not one-per-turn, so its columns move from job_application_screening_turns
-- to job_applications. video_r2_key/video_content_type on turns (added in
-- 20260904210000) and the older video_stream_uid have never been populated
-- by a real submission — safe to drop outright rather than migrate data.
alter table public.job_applications
  add column if not exists video_r2_key text,
  add column if not exists video_content_type text;

alter table public.job_application_screening_turns
  drop column if exists video_r2_key,
  drop column if exists video_content_type,
  drop column if exists video_stream_uid,
  add column if not exists video_offset_ms integer;
