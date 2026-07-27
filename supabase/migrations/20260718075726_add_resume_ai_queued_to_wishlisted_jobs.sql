/*
# Add resume_ai_queued flag to wishlisted_jobs

1. Modified Tables
   - `wishlisted_jobs`
     - `resume_ai_queued` (boolean, default false) - Indicates the job is queued for Resume AI processing

2. Important Notes
   - This flag is used to filter jobs that appear in the Resume AI page queue
   - Jobs are marked as queued from the Job Finder when user clicks "Add to Resume AI Queue"
*/

ALTER TABLE wishlisted_jobs ADD COLUMN IF NOT EXISTS resume_ai_queued boolean NOT NULL DEFAULT false;
