# Hotlist Page — Technical Documentation

> **File**: `src/pages/SocialHotlistPage.tsx` (5 lines) → `src/pages/PulsePage.tsx` (~5,308 lines, `feedKind="hotlist"`)
> **Route**: `/hotlist`
> **Purpose**: The Hotlist feed for bench sales recruiters. Surfaces available consultants / bench candidates posted by bench sales recruiters across social platforms, matched to watched role profiles. Provides credit-gated contact reveal and an "Ask AI" workflow that emails recruiters to request a consultant's resume. The thread appears in the Inbox page.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Differences from Jobs](#differences-from-jobs)
4. [Data Model](#data-model)
5. [Types & Interfaces](#types--interfaces)
6. [Constants](#constants)
7. [State Management](#state-management)
8. [Data Flow & Lifecycle](#data-flow--lifecycle)
9. [Core Functions](#core-functions)
10. [UI Layout & Components](#ui-layout--components)
11. [Feature Details](#feature-details)
12. [Credit System](#credit-system)
13. [Database Tables & RPCs Used](#database-tables--rpcs-used)
14. [Dependencies](#dependencies)

---

## Overview

The Hotlist page is a thin wrapper around the shared `PulsePage` component with the `feedKind="hotlist"` prop. It reuses the entire Jobs-page engine but changes the data source and terminology:

- **Data source**: `social_hotlist` table (bench consultant postings) instead of `social_jobs` (job postings).
- **Terminology**: "Consultant" replaces "Job", "Bench Sales Recruiter" replaces "Vendor", "Available Consultant" replaces "Job Opportunity".
- **Ask AI action**: Requests a consultant's **resume** from the bench sales recruiter (instead of requesting missing job details).
- **No Tracker sync**: Revealing a bench recruiter's contact does **not** auto-create a vendor in Tracker.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          AppNav (top bar)                        │
├──────────────────────────────────────────────────────────────────┤
│  Category Pills (desktop horizontal scroll, consul./recruiter)   │
├──────────────────────────────────────────────────────────────────┤
│  Tech-stack sub-filter pills (when a category is selected)       │
├──────────────────────────────────────────────────────────────────┤
│  Search bar (natural language + intent parse)  | Range | Refresh │
│  Desktop tabs: Recent / Revealed / Asked / Verified              │
├──────────────────────────────────────────────────────────────────┤
│  Hotlist Feed                                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Consultant Card (3-column masonry on desktop)             │  │
│  │  Title • Posted x ago • Masked recruiter • Company • Src   │  │
│  │  [Ask AI]  Exp | Work Type | Emp Type | Rate | Visa | Loc  │  │
│  │  [Reveal] [Breakdown] [View]                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ... more cards ...                                              │
├──────────────────────────────────────────────────────────────────┤
│  Modals: Ask AI preview (resume request) | Lead detail           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Differences from Jobs

The Hotlist page shares ~95% of its code with the Jobs page. The differences are driven by the `isHotlistFeed` flag:

| Aspect | Jobs (`feedKind="jobs"`) | Hotlist (`feedKind="hotlist"`) |
|--------|--------------------------|--------------------------------|
| `SocialHotlistPage` wrapper | N/A | `return <PulsePage feedKind="hotlist" />` |
| Data source | `social_jobs` | `social_hotlist` |
| Feed RPC | `get_pulse_social_feed` / `get_pulse_social_feed_page` | `get_social_hotlist_feed_page` |
| Default title | `Job Opportunity` | `Available Consultant` |
| Poster fallback | `Vendor contact` | `Bench Sales Recruiter` |
| Stats labels | `Jobs` / `Vendors` | `Consultants` / `Bench Recruiters` |
| Ask AI payload | Missing job details | `['resume']` |
| Ask AI icon | `Mail` | `FileText` |
| Ask AI tooltip | "Ask AI to request the missing details" | "Ask AI to request the consultant's resume" |
| Reveal toast | "Vendor auto-saved to Tracker" | "Bench Sales Recruiter contact revealed" |
| Tracker sync | Yes (`saveVendorToTracker`) | No (returns `true` immediately) |
| Vector search | Enabled | Disabled (`setVectorSearchLeadIds(null)`) |
| Search history page | `/jobs` | `/hotlist` |
| Empty state | "No recent jobs." | "No recent consultants." |
| Work type normalization | Raw value | `normalizeHotlistWorkType()` applied |

---

## Data Model

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `social_hotlist` | Scraped bench consultant / hotlist postings (LinkedIn, Facebook, etc.) |
| `radar_match_hotlist` | Pre-computed AI match scores for hotlist postings |
| `pulse_lead_actions` | Tracks reveal/breakdown actions |
| `hotlist_ai_roles` | User's watched roles |
| `accounts` / `account_members` | Multi-tenant account system |
| `social_hotlist_requests` | Tracks resume request state (asked/verified) |
| `credit_transactions` | Usage log entries |

### Supabase RPCs

| RPC | Purpose |
|-----|---------|
| `get_pulse_persona_leaderboard` | Aggregated leaderboard with watcher counts |
| `get_social_hotlist_feed_page` | Keyset-paginated hotlist feed (all-account) |
| `consume_feature_credit` | Deduct credits for reveal/breakdown actions |

---

## Types & Interfaces

The Hotlist page reuses the same types as the Jobs page (`PulsePageProps`, `SocialLead`, `PulsePersona`, `AskedJobState`, `GlobalAskedJobState`, `AskAIPreview`, `MatchesTabId`, etc.). The `SocialLead` for hotlist is hydrated from `social_hotlist` rows:

| `social_hotlist` field | `SocialLead` field |
|------------------------|--------------------|
| `role_title` | `title` / `roleTitle` |
| `bench_sales_recruiter_name` | `posterName` |
| `bench_sales_recruiter_email` | `posterEmail` |
| `bench_sales_recruiter_phone` | `posterPhone` |
| `bench_sales_company_name` | `company` |
| `locations` | `location` |
| `core_skills` | `skills` |
| `years_experience` | `experienceYears` |
| `visa_type` | `visaTypes` |
| `hourly_rate_min` / `hourly_rate_max` | `hourlyRate` |
| `raw_post_content` | `snippet` |
| `posted_at` / `created_at` | `postedAt` / `createdAt` |

---

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `LEADERBOARD_RPC_LIMIT` | `500` | Max roles fetched from leaderboard RPC |
| `FEED_WINDOW_HOURS` | `48` | Time window for fetching hotlist matches |
| `PULSE_ROWS_CACHE_TTL_MS` | `30_000` | In-memory feed cache TTL |
| `TOP_PROFILES_PAGE_SIZE` | `10` | Page size for top profiles section |
| `MATCHES_PAGE_SIZE` | `5` | Mobile matches page size |
| `DESKTOP_MATCHES_PAGE_SIZE` | `12` | Desktop matches page size |
| `REVEAL_CONTACT_COST` | `0.10` | Credits charged to reveal contact info |
| `BREAKDOWN_COST` | `0.1` | Credits charged to view AI breakdown |

> Note: `REVEAL_CONTACT_COST` is `0.10` in the Hotlist/Jobs context (this differs from the Pulse directory page which uses `0.25`).

Also reuses `PROFILE_RANGE_OPTIONS`, `PROFILE_CATEGORY_TABS`, `CATEGORY_TECH_STACKS`, `EXPERIENCE_RANGE_OPTIONS`, `WORK_TYPE_OPTIONS`, `EMPLOYMENT_TYPE_OPTIONS`, `VISA_STATUS_OPTIONS`, and `DEFAULT_FEED_SEARCH_FILTERS` from the shared component.

---

## State Management

All state is identical to the Jobs page (see `docs/jobs-page-documentation.md` State Management section). Notable hotlist-specific behavior:

| Variable | Hotlist behavior |
|----------|------------------|
| `vectorSearchLeadIds` | Always `null` (vector search disabled) |
| `askedJobStateByLeadId` | Loaded from `social_hotlist_requests` |
| `globalAskedJobStateByLeadId` | Loaded from `get_pulse_asked_job_states` |
| `feedTimeBasis` | Always `'posted'` (no toggle for hotlist) |

---

## Data Flow & Lifecycle

### 1. Initial Load

```
loadPulsePage()
  ├── loadLeaderboard() → get_pulse_persona_leaderboard RPC
  ├── loadWatchingRoles() → hotlist_ai_roles WHERE is_active=true
  ├── loadLeadActionState() → pulse_lead_actions
  └── loadAskedJobState() → social_hotlist_requests (hotlist-specific)
        └── get_pulse_asked_job_states RPC
```

### 2. Feed Loading

```
loadFeed()
  ├── getGlobalHotlistRows(rangeHours)
  │     ├── In-memory cache (30s TTL)
  │     └── get_social_hotlist_feed_page RPC (all-account feed)
  │           └── Enrich with radar_match_hotlist by hotlist_id
  ├── Filter by selected time range
  ├── Deduplicate via buildPulseLeadDedupKey()
  └── Sort by compareDetailsAndPostedDate() → set feed
```

Note: In hotlist mode, sorting always uses `compareDetailsAndPostedDate` (detail completeness first, then recency), and the feed is **not** enriched from the `pulse-feed-cache` worker or the vector search path.

### 3. Reveal Contact Flow

```
User clicks Reveal on a consultant lead
  ├── consumeCredits(0.10, 'pulse_reveal_contact')
  ├── persistLeadAction(lead.id, 'revealed')
  ├── saveVendorToTracker(lead) → returns true immediately (no-op)
  └── setRevealedLeadIds + toast "Bench Sales Recruiter contact revealed"
```

### 4. Ask AI (Resume Request)

```
User clicks Ask AI on a consultant lead
  ├── missingDetails = ['resume']  (hardcoded for hotlist)
  ├── invoke ask-ai-vendor-email edge function (lead_type='hotlist', action='preview')
  │     └── Returns generated email requesting the resume
  ├── Show preview modal (user can edit, must be < 40 words)
  └── On submit (action='send')
        └── Sends email to bench sales recruiter → creates vendor_conversation
              └── Shows up in the Inbox page (tagged as "Hotlist")
```

---

## Core Functions

All core functions are inherited from the shared `PulsePage` component. The hotlist-specific behaviors are:

| Function | Hotlist behavior |
|----------|------------------|
| `saveVendorToTracker(lead)` | Returns `true` immediately — no Tracker sync |
| `parseFeedSearchIntent(raw)` | Same as Jobs (employment/work/visa/rate parse) |
| `getGlobalHotlistRows(rangeHours)` | Calls `get_social_hotlist_feed_page` instead of `get_pulse_social_feed*` |
| `normalizeHotlistWorkType(value)` | Normalizes `remote`/`hybrid`/`onsite` from hotlist breakdown |
| `handleAskAI(lead)` | `leadType='hotlist'`, `missingDetails=['resume']` |
| `generateEmailDraft(lead)` | Generates a pitching email draft |
| `generateRequestDetailsEmailDraft(lead)` | Generates a resume-request email draft |

---

## UI Layout & Components

The UI is identical to the Jobs page layout, with hotlist-specific labels:

### AppNav
Top navigation bar with global nav.

### Category Pills (Desktop)
- Same category pills; badges show **Consultant** and **Bench Recruiter** counts instead of Jobs/Vendors.

### Search & Filter Row
- Same natural-language search with recent-search dropdown (persisted to `/hotlist` page history).
- Desktop tabs: Recent / Revealed / Asked / Verified with counts.
- No feed time basis toggle.
- Range picker: 24h / 3d / 7d / 15d / 30d.

### Match Feed
- **Mobile**: single-column card list with infinite scroll.
- **Desktop**: 3-column masonry layout with card palette cycling.
- **Consultant cards** show:
  - Title (`Available Consultant` fallback)
  - `Posted x ago` + masked recruiter name + company + platform
  - Ask AI button (FileText icon): `Ask` / `Asked` / `Verified` states
  - 6-cell detail grid: Exp, Work Type, Emp Type, Rate, Visa, Location
  - Skills row (blurred until breakdown expanded)
  - Action buttons: Reveal / Breakdown / View

### Pull-to-Refresh (Mobile)
- Same touch-based pull gesture as Jobs.

### Ask AI Preview Modal
- Shows generated resume-request email subject + content
- Allows editing (must be under 40 words)
- Pitching / Request Details tabs

### Lead Detail Modal
- Full consultant details + score breakdown table
- Copy Email / Copy Phone buttons (revealed only)
- Generate Email (auto-generated pitch draft)

---

## Feature Details

### Terminology Mapping
Throughout the UI, `isHotlistFeed` swaps labels:
- `Jobs` → `Consultants`
- `Vendors` → `Bench Recruiters`
- `Job Opportunity` → `Available Consultant`
- `Vendor contact` → `Bench Sales Recruiter`
- `Vendor email` → `Bench Sales Recruiter email`

### Resume Request (Ask AI)
For Hotlist, the Ask AI workflow always requests the consultant's **resume** (there are no "missing job details" to infer). The edge function is invoked with `lead_type='hotlist'` and `missing_details=['resume']`.

### Work Type Normalization
Hotlist postings use varied work-type strings. `normalizeHotlistWorkType()` maps them to consistent `Remote` / `Hybrid` / `Onsite` values (or `-` if unknown).

### No Tracker Integration
Unlike Jobs, revealing a bench sales recruiter's contact does not create a Tracker vendor record. The reveal only unmask the contact details locally.

### Inbox Integration
When a resume request email is sent, a `vendor_conversation` is created. In the Inbox page, these conversations are tagged with a purple **"Hotlist"** badge (vs. a gray **"Job"** badge for job conversations) and reference `social_hotlist` details.

---

## Credit System

| Action | Cost | What Happens |
|--------|------|-------------|
| Reveal Contact | **$0.10** | Unmasks name/email/phone of bench sales recruiter |
| Breakdown | **$0.10** | Shows detailed AI scoring table |
| Ask AI email | `ASK_AI_COST` in edge function (0.01) | Generates + sends resume-request email |

---

## Database Tables & RPCs Used

| Object | Operations | Purpose |
|--------|-----------|---------|
| `social_hotlist` | SELECT | Scraped bench consultant postings |
| `radar_match_hotlist` | SELECT | Pre-computed hotlist match scores |
| `pulse_lead_actions` | SELECT, UPSERT | Track reveal/breakdown actions |
| `hotlist_ai_roles` | SELECT, INSERT, UPDATE | Role watching state & settings |
| `accounts` | SELECT | Account context, credits balance |
| `account_members` | SELECT | Membership display names |
| `credit_transactions` | INSERT | Usage log entries |
| `pulse_search_history` | INSERT, SELECT | Recent search history (page = `/hotlist`) |
| `social_hotlist_requests` | SELECT | Resume request state |
| `get_pulse_persona_leaderboard` | RPC | Leaderboard with watcher counts |
| `get_social_hotlist_feed_page` | RPC | All-account hotlist feed |
| `get_pulse_asked_job_states` | RPC | Asked/verified state |
| `consume_feature_credit` | RPC | Credit deduction |

### Row-Level Security
Same as Jobs — RLS scoped to account via `account_members`, with SECURITY DEFINER RPCs for the global hotlist feed.

---

## Dependencies

| Dependency | Usage |
|------------|-------|
| `react`, `react-router-dom` | Core framework, navigation |
| `lucide-react` | Icons (FileText for resume request, etc.) |
| `AppNav` | Top navigation bar |
| `Toast` | Notification toasts |
| `LogoSpinner` | Loading spinner |
| `useAuth` | Authentication context |
| `useTheme` | Dark mode styling |
| `supabase` | Database client + edge function invocation |
| `HOTLIST_AI_SUGGESTIONS` | Seed role suggestions |
| `buildScoreBreakdownDisplayItems` | Score breakdown display formatting |
| `matchesPulseFeedSearch` | Feed search matching |
| `ask-ai-vendor-email` edge function | AI email generation + sending |