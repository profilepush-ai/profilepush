# Apify Scraper + Job Watch AI Architecture

## Overview
The pipeline has been restructured to separate **job scraping** (Apify) from **job matching** (pgvector + Gemini). This provides better scalability, cost efficiency, and flexibility.

---

## Architecture

### Part 1: Job Scraping (Apify Native Scheduler)
**Triggered**: Apify Native Scheduler - **Daily at 3 PM IST (09:30 UTC)**
**Function**: `/functions/v1/apify-scraper-scheduler`
**What it does**:
1. Fetches all active hotlist profiles from `hotlist_active_profiles` view
2. For each profile, extracts: target_role, location, preferred_locations
3. Calls board-specific scrapers for all configured boards:
   - `linkedin-search` (via Apify: worldunboxer~rapid-linkedin-scraper)
   - `dice-search` (via Apify: shahidirfan~dice-job-scraper)
   - `indeed-search` (Apify actor)
   - `monster-search` (Apify actor)
   - `careerbuilder-search` (Apify actor)
4. Each scraper fetches ~25 jobs matching the profile's role + location
5. Jobs are stored in respective tables:
   - `linkedin_jobs`
   - `dice_jobs`
   - `indeed_jobs`
   - `monster_jobs`
   - `careerbuilder_jobs`

**File**: `supabase/functions/apify-scraper-scheduler/index.ts`

### Part 2: Job Matching (Job Watch Trigger)
**Triggered**: pg_cron jobs at specific times
**Function**: `/functions/v1/job-watch-trigger`
**Modified to**: Only handle pgvector semantic search + Gemini LLM scoring

#### Schedule 1: Board Jobs (LinkedIn, Dice, Indeed, Monster, CareerBuilder)
- **Trigger**: pg_cron - **Daily at 4 PM IST (10:30 UTC)**
- **Query**: `frequency = 'daily'` in `watch_schedules` table
- **What it does**:
  1. Loads all daily-frequency watch schedules
  2. For each schedule's profiles, calls `/functions/v1/radar-match`
  3. radar-match uses pgvector to find >70% similarity jobs from job tables
  4. Gemini LLM scores each match (skills, experience, visa, location, etc.)
  5. Stores results in `radar_match_results`
  6. Creates notification if matches found

**File**: `supabase/functions/job-watch-trigger/index.ts` (simplified - scraping removed)

#### Schedule 2: Social Jobs
- **Trigger**: pg_cron - **Every 3 hours** (00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 UTC)
- **Query**: `frequency = '3_hours'` in `watch_schedules` table
- **What it does**:
  1. Loads all 3-hour-frequency watch schedules (filtered for social jobs)
  2. For each schedule's profiles, calls `/functions/v1/radar-match`
  3. Same pgvector + Gemini scoring pipeline
  4. Matches against `social_jobs` table
  5. Creates notifications

---

## Database Changes

### New Functions
- `apify-scraper-scheduler`: Fetches hotlist profiles and triggers scrapers
- (Modified) `job-watch-trigger`: Removed scraping stage, now only matches

### New Migrations
- `20260729130000_add_apify_scraper_and_watch_cron_jobs.sql`
  - Creates 3 pg_cron jobs:
    1. `apify-scraper-scheduler-daily` → calls `/functions/v1/apify-scraper-scheduler`
    2. `job-watch-trigger-boards-daily` → calls `/functions/v1/job-watch-trigger` (frequency_filter='daily')
    3. `job-watch-trigger-social-3hours` → calls `/functions/v1/job-watch-trigger` (frequency_filter='3_hours')

### Modified Tables
- `watch_schedules`: Now supports frequency = `'3_hours'` (in addition to 'hourly', 'twice_daily', 'daily', 'weekly')

---

## Setup Instructions

### Step 1: Deploy Code Changes
```bash
cd /path/to/profilepush-ai-main
npm run build
npx supabase push  # Deploy migrations and edge functions
```

### Step 2: Configure Apify Native Scheduler

The Apify native scheduler must call the edge function daily at 3 PM IST (09:30 UTC):

#### Option A: Using Apify's Web UI
1. Go to [Apify Console](https://console.apify.com)
2. Create a new scheduled task or actor run
3. Set up a webhook/HTTP call:
   - **URL**: `https://your-supabase-project.supabase.co/functions/v1/apify-scraper-scheduler`
   - **Method**: POST
   - **Headers**:
     ```json
     {
       "Content-Type": "application/json",
       "Authorization": "Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY"
     }
     ```
   - **Body**:
     ```json
     {
       "boards": ["linkedin", "dice", "indeed", "monster", "careerbuilder"]
     }
     ```
4. **Schedule**: Daily at 3 PM IST (09:30 UTC)
   - Apify uses UTC by default
   - Set cron: `30 9 * * *`

#### Option B: Using Apify API
```bash
curl -X POST https://api.apify.com/v2/acts/your-actor-id/runs/schedule \
  -H "Authorization: Bearer YOUR_APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cronExpression": "30 9 * * *",
    "timezone": "UTC",
    "webhooks": [
      {
        "eventTypes": ["ACTOR_RUN_SUCCEEDED"],
        "requestUrl": "https://your-supabase-project.supabase.co/functions/v1/apify-scraper-scheduler",
        "headers": {
          "Authorization": "Bearer YOUR_SUPABASE_SERVICE_ROLE_KEY",
          "Content-Type": "application/json"
        },
        "payload": {
          "boards": ["linkedin", "dice", "indeed", "monster", "careerbuilder"]
        }
      }
    ]
  }'
```

### Step 3: Verify pg_cron Jobs
```sql
-- Check that cron jobs are created
select * from cron.job;

-- Expected 3 jobs:
-- 1. apify-scraper-scheduler-daily
-- 2. job-watch-trigger-boards-daily
-- 3. job-watch-trigger-social-3hours
```

### Step 4: Create Watch Schedules
Create watch schedule entries in `watch_schedules` table with appropriate frequencies:

```sql
-- Example: Board jobs watch (daily at 4 PM IST)
insert into watch_schedules (
  account_id, profile_id, frequency, is_active, boards, description
) values (
  'your-account-id', null, 'daily', true, 
  array['linkedin', 'dice', 'indeed', 'monster', 'careerbuilder'],
  'Daily watch for all board jobs on all hotlist profiles'
);

-- Example: Social jobs watch (every 3 hours)
insert into watch_schedules (
  account_id, profile_id, frequency, is_active, boards, description
) values (
  'your-account-id', null, '3_hours', true, 
  array['social'],
  'Social jobs watch every 3 hours'
);
```

---

## Timeline

### 3:00 PM IST (09:30 UTC)
✅ **Apify Scraper Scheduler runs**
- Fetches 50-100 hotlist profiles
- Scrapes ~1,250-2,500 jobs from 5 boards per profile
- Total: ~2,500-12,500 new jobs added to job tables

### 4:00 PM IST (10:30 UTC)
✅ **Job Watch Trigger (Daily) runs**
- Processes all `frequency='daily'` watch schedules
- Matches scraped board jobs against hotlist profiles
- pgvector: 70%+ similarity filtering
- Gemini: AI scoring each match
- Creates notifications with matching job results

### Every 3 Hours (00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 UTC)
✅ **Job Watch Trigger (Social) runs**
- Processes all `frequency='3_hours'` watch schedules
- Matches social jobs against hotlist profiles
- Same pgvector + Gemini pipeline
- Social jobs refresh more frequently (new content posted often)

---

## Cost Optimization

### Scraping Costs
- ✅ Apify actors run once daily (not repeatedly per watch schedule)
- ✅ Single scrape fetches jobs for ALL hotlist profiles at once
- ✅ All matched jobs are reused for multiple candidate profiles

### Matching Costs
- ✅ Radar-match (pgvector + Gemini) runs only when needed
- ✅ Board jobs: 1x daily (10:30 UTC)
- ✅ Social jobs: 8x daily (every 3 hours)
- ✅ Gemini LLM scoring: ~$0.025 per match

**Estimated Monthly Cost** (for 50 hotlist profiles, 8 board jobs/profile/day, 2 social jobs/profile × 8):
- Scraping: ~$15-20 (Apify actors)
- Matching: ~$30-50 (Gemini LLM)
- **Total: ~$50-70/month**

---

## Troubleshooting

### Apify Scheduler Not Triggering
1. Verify Apify scheduled task is configured with correct UTC time (09:30)
2. Check Apify webhook logs for failed calls
3. Verify Supabase service role key is correct
4. Test manually: `curl -X POST https://your-supabase.supabase.co/functions/v1/apify-scraper-scheduler ...`

### Jobs Not Being Matched
1. Check `watch_schedules` table has active entries with `frequency='daily'` or `'3_hours'`
2. Verify `hotlist_active_profiles` view returns profiles (profiles created ≤15 days ago)
3. Check `watch_schedule_runs` table for errors in the last run
4. Verify radar-match function has access to job tables and profiles table

### pg_cron Jobs Not Running
1. Verify pg_cron extension is enabled: `select * from cron.job;`
2. Check cron job logs: `select * from cron.job_run_details order by start_time desc;`
3. Verify Supabase has pg_cron enabled in the project settings

---

## Key Changes Summary

| Component | Before | After |
|-----------|--------|-------|
| **Scraping** | Inside `job-watch-trigger` | Separate `apify-scraper-scheduler` |
| **Scraping Schedule** | N/A (tied to matching) | Daily 3 PM IST |
| **Scraping Efficiency** | Per-schedule (multiple scrapes) | Global (single scrape for all profiles) |
| **Matching Schedule** | Variable (depends on watch frequency) | Fixed: 4 PM IST + Every 3 hours |
| **Code Complexity** | Single function with 2 stages | Separated: scraper + matcher |
| **Cost** | Higher (multiple scrapes) | Lower (single scrape for all) |
| **Flexibility** | Limited (can't scrape without matching) | High (can scrape/match independently) |

---

## Files Changed

1. ✅ `supabase/functions/job-watch-trigger/index.ts`
   - Removed Part 1 (Apify scraping)
   - Kept Part 2 & 3 (pgvector + Gemini matching)
   - Added `frequency_filter` parameter support
   - Added support for `3_hours` frequency

2. ✅ `supabase/functions/apify-scraper-scheduler/index.ts` (NEW)
   - Fetches `hotlist_active_profiles` view
   - Loops through profiles and calls board scrapers
   - Manages concurrency (MAX_CONCURRENT = 20)

3. ✅ `supabase/migrations/20260729130000_add_apify_scraper_and_watch_cron_jobs.sql` (NEW)
   - Creates 3 pg_cron jobs with correct IST→UTC conversion
   - Job 1: Scraper at 09:30 UTC (3 PM IST)
   - Job 2: Board matcher at 10:30 UTC (4 PM IST)
   - Job 3: Social matcher every 3 hours

---

## Next Steps

1. **Deploy migrations**: `npx supabase push`
2. **Set up Apify scheduler**: Configure daily call to apify-scraper-scheduler at 3 PM IST
3. **Create watch schedules**: Insert entries with `frequency='daily'` and `'3_hours'`
4. **Monitor**: Watch `watch_schedule_runs` table for successful executions
5. **Optimize**: Adjust boards/frequency based on usage patterns and costs
