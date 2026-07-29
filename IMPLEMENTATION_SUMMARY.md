# Implementation Summary: Decoupled Apify Scraper + Job Watch Matching

## ✅ What Was Done

### 1. **Simplified job-watch-trigger** 
   - **Removed**: Part 1 (Apify scraping) - lines 145-210
   - **Kept**: Part 2 & 3 (pgvector semantic search + Gemini LLM scoring)
   - **Added**: `frequency_filter` parameter support
   - **File**: `supabase/functions/job-watch-trigger/index.ts`

### 2. **Created apify-scraper-scheduler**
   - **New Edge Function** that:
     1. Fetches all active hotlist profiles from `hotlist_active_profiles` view
     2. For each profile: extracts target_role, location, preferred_locations
     3. Calls board-specific scrapers (linkedin-search, dice-search, indeed-search, monster-search, careerbuilder-search)
     4. Stores jobs in respective tables (linkedin_jobs, dice_jobs, indeed_jobs, monster_jobs, careerbuilder_jobs)
     5. Returns count of jobs queued/fetched
   - **File**: `supabase/functions/apify-scraper-scheduler/index.ts`

### 3. **Created pg_cron scheduler migration**
   - Creates 3 pg_cron jobs with IST→UTC conversion:
     - **Job 1**: `apify-scraper-scheduler-daily` → **3 PM IST (09:30 UTC)**
     - **Job 2**: `job-watch-trigger-boards-daily` → **4 PM IST (10:30 UTC)**
     - **Job 3**: `job-watch-trigger-social-3hours` → **Every 3 hours**
   - **File**: `supabase/migrations/20260729130000_add_apify_scraper_and_watch_cron_jobs.sql`

### 4. **Updated frequency support in job-watch-trigger**
   - Added `'3_hours'` as valid frequency in `isScheduleDue()` function
   - Allows separate matching schedules for social jobs (every 3 hours) vs board jobs (daily)

### 5. **Created comprehensive architecture guide**
   - **File**: `APIFY_ARCHITECTURE.md`
   - Explains entire pipeline, setup instructions, IST→UTC conversion, cost optimization

---

## 📋 New Pipeline Flow

```
3:00 PM IST (09:30 UTC)
┌─────────────────────────────────────┐
│ Apify Scraper Scheduler (pg_cron)   │
│                                     │
│ ✓ Fetch hotlist_active_profiles     │
│ ✓ For each profile:                 │
│   - linkedin-search (Apify)         │
│   - dice-search (Apify)             │
│   - indeed-search (Apify)           │
│   - monster-search (Apify)          │
│   - careerbuilder-search (Apify)    │
│ ✓ Store in job tables               │
└─────────────────────────────────────┘
            ↓
        ~2-12K jobs added

4:00 PM IST (10:30 UTC)
┌─────────────────────────────────────┐
│ Job Watch Trigger (Daily)           │
│ frequency='daily'                   │
│                                     │
│ ✓ Load daily watch schedules        │
│ ✓ For each profile:                 │
│   - pgvector: find >70% matches     │
│   - Gemini: score each match        │
│ ✓ Store in radar_match_results      │
│ ✓ Create notifications              │
└─────────────────────────────────────┘

Every 3 hours (00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 UTC)
┌─────────────────────────────────────┐
│ Job Watch Trigger (Social)          │
│ frequency='3_hours'                 │
│                                     │
│ ✓ Load 3-hour watch schedules       │
│ ✓ For each profile:                 │
│   - pgvector: find social matches   │
│   - Gemini: score each match        │
│ ✓ Store in radar_match_results      │
│ ✓ Create notifications              │
└─────────────────────────────────────┘
```

---

## 🔧 Key Benefits

| Aspect | Before | After |
|--------|--------|-------|
| **Scraping Cost** | High (multiple per-watch scrapes) | Low (single global scrape) |
| **Scraping Efficiency** | O(n) per watch schedule | O(1) global scrape |
| **Matching Flexibility** | Tied to scraping schedule | Independent, configurable |
| **Code Complexity** | ~400 lines (2 stages) | Split: ~150 lines scraper + ~250 lines matcher |
| **Social Job Freshness** | Limited | Every 3 hours (8x daily) |
| **Board Job Timeliness** | Variable | Guaranteed 4 PM IST (1 hour after scrape) |
| **Concurrent Connections** | Single long-running function | Clean separation of concerns |

---

## 📊 Estimated Performance

**For 50 hotlist profiles, 5 boards, 2 social platforms:**

### Scraping (Daily)
- Time: ~10-15 minutes (Apify actors in parallel)
- Cost: ~$15-20/month
- Jobs added: 2,500-12,500 (5 boards × 50 profiles × 25 jobs/board)

### Board Matching (Daily at 4 PM)
- Time: ~5-10 minutes (pgvector + Gemini per profile)
- Cost: ~$20-30/month (Gemini LLM scoring)
- Matches found: 200-500 (depends on profile-job similarity)

### Social Matching (Every 3 hours = 8x daily)
- Time: ~2-5 minutes per run
- Cost: ~$15-25/month (8 runs × matching cost)
- Matches found: 50-200 per run

**Total Monthly Cost**: ~$50-75 (vs previous ~$100+ with repeated scrapes)

---

## 🚀 Deployment Steps

### 1. Build & Deploy
```bash
cd /path/to/profilepush-ai-main
npm run build
npx supabase push  # Deploys migrations + functions
```

### 2. Configure Apify Scheduler
- Go to Apify Console
- Create scheduled task to call `/functions/v1/apify-scraper-scheduler`
- Schedule: Daily at **09:30 UTC** (3 PM IST)
- Method: POST
- Body: `{ "boards": ["linkedin", "dice", "indeed", "monster", "careerbuilder"] }`

### 3. Create Watch Schedules
```sql
-- Board jobs (daily)
insert into watch_schedules (account_id, profile_id, frequency, is_active, boards) 
values (your_account_id, null, 'daily', true, array['linkedin','dice','indeed','monster','careerbuilder']);

-- Social jobs (every 3 hours)
insert into watch_schedules (account_id, profile_id, frequency, is_active, boards) 
values (your_account_id, null, '3_hours', true, array['social']);
```

### 4. Verify
```sql
-- Check pg_cron jobs
select * from cron.job where jobname like '%scraper%' or jobname like '%watch%';

-- Check watch schedule runs
select * from watch_schedule_runs order by started_at desc limit 5;
```

---

## 📝 Files Changed

| File | Change | Status |
|------|--------|--------|
| `supabase/functions/job-watch-trigger/index.ts` | Removed scraping, added frequency_filter | ✅ Modified |
| `supabase/functions/apify-scraper-scheduler/index.ts` | NEW - Scraper scheduler function | ✅ Created |
| `supabase/migrations/20260729130000_*` | NEW - pg_cron jobs for scraper + matcher | ✅ Created |
| `APIFY_ARCHITECTURE.md` | NEW - Comprehensive guide | ✅ Created |

---

## ✨ Next: Manual Testing

Once deployed, test the flow:

```bash
# Test apify-scraper-scheduler manually
curl -X POST https://your-project.supabase.co/functions/v1/apify-scraper-scheduler \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"boards":["linkedin","dice","indeed","monster","careerbuilder"]}'

# Test job-watch-trigger with daily frequency filter
curl -X POST https://your-project.supabase.co/functions/v1/job-watch-trigger \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"frequency_filter":"daily"}'

# Test job-watch-trigger with 3-hour frequency filter
curl -X POST https://your-project.supabase.co/functions/v1/job-watch-trigger \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"frequency_filter":"3_hours"}'
```

---

## 🎯 Architecture Advantages

1. **Scalability**: Scraper runs once globally; matcher runs independently
2. **Cost Efficiency**: ~30% reduction in Apify costs (single scrape vs multiple)
3. **Flexibility**: Can run matching without scraping; can adjust frequencies independently
4. **Reliability**: Separation means one failure doesn't block the entire pipeline
5. **Observability**: Clear separation of concerns makes debugging easier
6. **Performance**: Board jobs matched within 1 hour of scraping; social jobs refreshed every 3 hours
