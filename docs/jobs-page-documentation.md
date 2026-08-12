# Jobs Page — Technical Documentation

> **File**: `src/pages/PulsePage.tsx` (~5,308 lines)
> **Route**: `/jobs`
> **Purpose**: The primary AI-powered social job lead feed for bench sales recruiters. Surfaces scraped social media job postings matched to watched role profiles, with privacy-masked contact info, AI score breakdowns, credit-gated reveal actions, and an "Ask AI" workflow that emails vendors to request missing job details.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Model](#data-model)
4. [Types & Interfaces](#types--interfaces)
5. [Constants](#constants)
6. [State Management](#state-management)
7. [Data Flow & Lifecycle](#data-flow--lifecycle)
8. [Core Functions](#core-functions)
9. [UI Layout & Components](#ui-layout--components)
10. [Feature Details](#feature-details)
11. [Credit System](#credit-system)
12. [Database Tables & RPCs Used](#database-tables--rpcs-used)
13. [Dependencies](#dependencies)

---

## Overview

The Jobs page is the main lead-generation feed. It is powered by the shared `PulsePage` component with `feedKind="jobs"` (the same component also powers `/hotlist` with `feedKind="hotlist"`).

Key responsibilities:
- Display a **role-profile board** organized by technology category, showing market stats (unique jobs, vendors, hotlists) per role.
- Render a **match feed** of social job postings from `social_jobs` and `radar_match_results`.
- Support **credit-gated reveal** of poster contact info (name, email, phone) and auto-sync to the Tracker page as vendor records.
- Support an **Ask AI** workflow that generates and sends emails to vendors requesting missing job details, which feeds into the Inbox page.
- Provide natural-language **feed search** with intent parsing (e.g. "Solutions Architect C2C $45" infers employment type, rate range, and role query).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          AppNav (top bar)                        │
├──────────────────────────────────────────────────────────────────┤
│  Category Pills (desktop horizontal scroll, vendor/job counts)   │
├──────────────────────────────────────────────────────────────────┤
│  Tech-stack sub-filter pills (when a category is selected)       │
├──────────────────────────────────────────────────────────────────┤
│  Search bar (natural language + intent parse)  | Range | Refresh │
│  Desktop tabs: Recent / Revealed / Asked / Verified              │
│  Feed time basis toggle (Posted / Created — beta-gated)          │
├──────────────────────────────────────────────────────────────────┤
│  Match Feed                                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Lead Card (3-column masonry on desktop)                   │  │
│  │  Title • Posted x ago • Masked poster • Company • Platform │  │
│  │  [Ask AI]  Exp | Work Type | Emp Type | Rate | Visa | Loc  │  │
│  │  [Reveal] [Breakdown] [View]                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ... more cards ...                                              │
├──────────────────────────────────────────────────────────────────┤
│  Modals: Ask AI preview | Lead detail + email drafts            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `social_jobs` | Scraped social media job postings (LinkedIn, Facebook, Dice, Indeed, etc.) |
| `radar_match_results` | Pre-computed AI match scores between profiles and jobs |
| `pulse_lead_actions` | Tracks user actions on leads (revealed, breakdown) |
| `hotlist_ai_roles` | User's watched roles with settings (frequency, active status, detail fields) |
| `accounts` / `account_members` | Multi-tenant account system & membership display names |
| `vendors` | Auto-populated vendor records from revealed leads |
| `pulse_search_history` | Recent feed search queries (per page) |
| `asked_job_details` / `social_hotlist_requests` | Ask AI request state (asked/verified) |
| `credit_transactions` | Usage log entries for credit consumption |

### Supabase RPCs

| RPC | Purpose |
|-----|---------|
| `get_pulse_persona_leaderboard` | Aggregated leaderboard with watcher counts |
| `get_pulse_social_feed` | Global SECURITY DEFINER feed of matched social job leads |
| `get_pulse_social_feed_page` | Keyset-paginated social feed |
| `get_pulse_asked_job_states` | Retrieve global asked/verified state for leads |
| `consume_feature_credit` | Deduct credits for reveal/breakdown actions |

### Cloudflare Worker

| Worker | Purpose |
|--------|---------|
| `pulse-feed-cache` | Edge-cached pulse feed rows (`VITE_PULSE_CACHE_WORKER_URL`) |

---

## Types & Interfaces

### `PulsePageProps`

| Field | Type | Description |
|-------|------|-------------|
| `feedKind` | `'jobs' \| 'hotlist'` | Feed variant. Defaults to `'jobs'`. |

### `SocialLead`
A matched job lead displayed in the feed.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Social job ID |
| `title` | `string` | Job title |
| `roleTitle` | `string` | Normalized role title |
| `location` | `string` | Job location |
| `company` | `string` | Company name |
| `posterName` | `string` | Name of person who posted |
| `posterEmail` | `string` | Poster's email (revealed on action) |
| `posterPhone` | `string` | Poster's phone (revealed on action) |
| `postedAt` | `string` | ISO timestamp |
| `createdAt` | `string` | ISO scrape timestamp |
| `postedAgo` | `string` | Human-readable time ago |
| `platform` | `string` | Source platform |
| `matchScore` | `number \| null` | AI match score (0–100) |
| `profileId` | `string \| null` | Linked profile ID |
| `scoreBreakdown` | `Record<string, unknown> \| null` | Detailed score breakdown |
| `snippet` | `string` | Post content snippet |
| `employmentType` | `string` | Employment type |
| `seniority` | `string` | Seniority level |
| `salaryRange` | `string` | Salary range text |
| `skills` | `string[]` | Extracted skills |
| `experienceYears` | `number \| null` | Extracted experience |
| `visaTypes` | `string[]` | Extracted visa types |
| `hourlyRate` | `string` | Extracted hourly rate |

### `PulsePersona`
A role profile on the board (same as elsewhere in the app).

### `FeedSearchFilters`
Filter state inferred from natural-language search.

| Field | Type |
|-------|------|
| `experienceRange` | `string` |
| `workType` | `string` |
| `employmentType` | `string` |
| `visaStatus` | `string` |
| `location` | `string` |
| `skillsQuery` | `string` |
| `rateMode` | `'all' \| 'has_rate' \| 'range'` |
| `rateMin` / `rateMax` | `string` |

### Other Types
- **`MatchesTabId`** — `'all' | 'breakdown' | 'revealed' | 'asked' | 'verified' | 'queued'`
- **`FeedTimeBasis`** — `'posted' | 'created'`
- **`LeadActionType`** — `'revealed' | 'breakdown'`
- **`AskedJobState`** — `{ requestedAt: string; fulfilledAt: string | null }`
- **`GlobalAskedJobState`** — `'asked' | 'verified'`
- **`EmailDraftTabId`** — `'pitching' | 'requestDetails'`
- **`AskAIPreview`** — Preview state for the Ask AI modal
- **`PulseLeadActionRow`** — `{ lead_id, action_type }`
- **`PulseRevealNamesRow`** — `{ lead_id, revealer_names }`

---

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `LEADERBOARD_RPC_LIMIT` | `500` | Max roles fetched from leaderboard RPC |
| `FEED_WINDOW_HOURS` | `48` | Time window for fetching social job matches |
| `PULSE_ROWS_CACHE_TTL_MS` | `30_000` | In-memory feed cache TTL |
| `TOP_PROFILES_PAGE_SIZE` | `10` | Page size for top profiles section |
| `MATCHES_PAGE_SIZE` | `5` | Mobile matches page size |
| `DESKTOP_MATCHES_PAGE_SIZE` | `12` | Desktop matches page size |
| `REVEAL_CONTACT_COST` | `0.10` | Credits charged to reveal contact info |
| `BREAKDOWN_COST` | `0.1` | Credits charged to view AI breakdown |

### `PROFILE_RANGE_OPTIONS`
Time range filters: 24h, 3d, 7d, 15d, 30d.

### `PROFILE_CATEGORY_TABS`
11 category tabs (All, Front-End, Backend, Data, Security, CRM, QA, Biz Dev, AI, ML, DevOps) with per-category accent colors.

### `EXPERIENCE_RANGE_OPTIONS`, `WORK_TYPE_OPTIONS`, `EMPLOYMENT_TYPE_OPTIONS`, `VISA_STATUS_OPTIONS`
Filter dropdown option sets.

### `CATEGORY_TECH_STACKS`
Per-category tech-stack sub-filters (e.g. Front-End → React, Angular, Vue…).

### `DEFAULT_FEED_SEARCH_FILTERS`
Baseline `FeedSearchFilters` (`'all'` for every selector, empty strings otherwise).

---

## State Management

### Core Data State

| Variable | Type | Purpose |
|----------|------|---------|
| `leaderboard` | `PulsePersona[]` | All personas on the board |
| `watchingRoles` | `Set<string>` | Normalized names of watched roles |
| `activePersona` | `PulsePersona \| null` | Currently selected persona |
| `feed` | `SocialLead[]` | Matched leads (global, pre-filter) |
| `feedLoading` | `boolean` | Feed loading state |
| `profileStatsByRole` | `Record<string, ProfileStats>` | Jobs/vendors/hotlists stats per role |

### Feed Search State

| Variable | Type | Purpose |
|----------|------|---------|
| `pendingFeedSearchQuery` | `string` | Search input text |
| `feedSearchQuery` | `string` | Applied search query |
| `feedSearchFilters` | `FeedSearchFilters` | Parsed filter state |
| `vectorSearchLeadIds` | `string[] \| null` | Vector-search result lead IDs |
| `recentSearches` | `string[]` | Recent search history |

### Action Tracking

| Variable | Type | Purpose |
|----------|------|---------|
| `revealedLeadIds` | `Set<string>` | Lead IDs where contact was revealed |
| `breakdownChargedLeadIds` | `Set<string>` | Lead IDs where breakdown was charged |
| `queuedLeadIds` | `Set<string>` | Lead IDs queued for later |
| `askedJobStateByLeadId` | `Record<string, AskedJobState>` | User's own Ask AI state |
| `globalAskedJobStateByLeadId` | `Record<string, GlobalAskedJobState>` | Global asked/verified state |

### UI State

| Variable | Type | Purpose |
|----------|------|---------|
| `view` | `'board' \| 'feed'` | Mobile view toggle |
| `profileRangeId` | `string` | Selected time range |
| `selectedCategoryId` | `string \| null` | Active category filter |
| `selectedTechStacks` | `string[]` | Active tech-stack sub-filter |
| `selectedMatchesTab` | `MatchesTabId` | Active matches tab |
| `selectedLead` | `SocialLead \| null` | Lead detail modal |
| `askAIPreview` | `AskAIPreview \| null` | Ask AI preview modal state |
| `isMobileTopCollapsed` | `boolean` | Mobile search bar collapse state |
| `pullDistance` | `number` | Mobile pull-to-refresh distance |

---

## Data Flow & Lifecycle

### 1. Initial Load (`useEffect` on mount)

```
loadPulsePage()
  ├── loadLeaderboard() → get_pulse_persona_leaderboard RPC
  │     └── Merge with hotlist_ai_roles/fetch fallback
  ├── loadWatchingRoles() → hotlist_ai_roles WHERE is_active=true
  ├── loadLeadActionState() → pulse_lead_actions
  │     └── Set revealedLeadIds, breakdownChargedLeadIds
  └── loadAskedJobState() → social_hotlist_requests (for hotlist)
        └── get_pulse_asked_job_states RPC (for jobs)
```

### 2. Feed Loading

```
loadFeed(persona, filter, forceRefresh)
  ├── getGlobalPulseRows(rangeHours)
  │     ├── In-memory cache check (30s TTL)
  │     ├── Optional: pulse-feed-cache Cloudflare worker
  │     └── get_pulse_social_feed RPC (SCHEMA-bound)
  │           └── Enrich with radar_match_results by job_id
  ├── Filter by selected time range
  ├── Deduplicate via buildPulseLeadDedupKey()
  └── Sort → set feed
```

### 3. Natural-Language Search

```
User types "Solutions Architect C2C $45" + Enter
  ├── parseFeedSearchIntent(raw)
  │     ├── Regex-consumes c2c → employmentType='c2c'
  │     ├── Regex-consumes $45 → rateMode='range', rateMin='45'
  │     └── Remaining text → roleQuery
  ├── mergeFeedFiltersWithIntent(base, inferred)
  ├── Opt-in: vector search via role_embedding (hotlist_ai_roles ↔ social_jobs)
  ├── Persist to pulse_search_history (page = /jobs)
  └── applyFeedSearch() → set feedSearchQuery + vectorSearchLeadIds
```

### 4. Reveal Contact Flow

```
User clicks Reveal on a lead
  ├── consumeCredits(0.10, 'pulse_reveal_contact')
  ├── persistLeadAction(lead.id, 'revealed')
  ├── saveVendorToTracker(lead) → upsert vendors table
  │     └── (skipped in hotlist mode)
  └── setRevealedLeadIds + toast
```

### 5. Ask AI Flow

```
User clicks Ask AI on a lead
  ├── determine missing details (getMissingJobDetails)
  ├── invoke ask-ai-vendor-email edge function (action='preview')
  │     └── Returns generated email subject + body (AI-generated via worker)
  ├── Show preview modal (user can edit, must be < 40 words)
  └── On submit (action='send')
        └── Sends email to vendor → creates vendor_conversation
              └── Shows up in the Inbox page
```

### 6. Reveal Names Aggregation

```
loadRevealNames() → pulse_lead_actions WHERE action_type='revealed'
  └── Group by lead_id → revealer_names array
      └── Shows "x recruiters revealed" badge on cards
```

---

## Core Functions

### Search & Intent Parsing

| Function | Purpose |
|----------|---------|
| `parseFeedSearchIntent(rawInput)` | Extract role query + inferred filters from natural language |
| `mergeFeedFiltersWithIntent(base, inferred)` | Merge typed filters with inferred ones |
| `applyFeedSearch()` | Apply search, run optional vector search, record history |
| `loadRecentSearches()` | Fetch recent searches for autocomplete dropdown |

### Feed & Matching

| Function | Purpose |
|----------|---------|
| `getGlobalPulseRows(rangeHours)` | Load global feed rows (cache → worker → RPC) |
| `loadGlobalPulseRowsFromCacheWorker(rangeHours)` | Fetch from pulse-feed-cache worker |
| `buildPulseLeadDedupKey(lead)` | Composite dedup key (title+company+location+poster) |
| `roleMatchesPersona(row, personaRole, personaSkills)` | Check if a social job matches the active persona |
| `compareDetailsAndPostedDate(a, b)` | Sort leads by detail completeness then recency |

### Credits & Actions

| Function | Purpose |
|----------|---------|
| `consumeCredits(amount, feature, metadata)` | Deduct via `consume_feature_credit` RPC with legacy fallback |
| `persistLeadAction(leadId, actionType)` | Upsert into `pulse_lead_actions` |
| `saveVendorToTracker(lead)` | Upsert vendor record (jobs mode only) |
| `handleRevealLead(lead)` | Reveal contact for a lead (wraps steps above) |
| `handleOpenBreakdown(lead)` | Charge + display AI breakdown |

### Ask AI

| Function | Purpose |
|----------|---------|
| `handleAskAI(lead)` | Generate AI email preview via edge function |
| `handleSubmitAskAI()` | Send the AI-generated request email |
| `getMissingJobDetails(lead)` | Determine which fields are missing on a lead |
| `generateEmailDraft(lead)` | Build a pitching email draft |
| `generateRequestDetailsEmailDraft(lead)` | Build a "request details" email draft |

### Display Helpers

| Function | Purpose |
|----------|---------|
| `normalize(text)` | Lowercase + trim + collapse whitespace |
| `canonicalizeRoleForUniqueness(role)` | Strip seniority prefixes for grouping |
| `getPersonaBucket(role)` | Bucket a role into a canonical persona |
| `inferRoleCategoryId(role)` | Match role to a category via regex |
| `formatAgo(dateIso)` | "5m ago", "3h ago", "2d ago" |
| `maskPosterName(name)` | Privacy mask: "John Smith" → "Joh••• Smi•••" |
| `hexToRgbChannels(hex)` | Convert hex accent to RGB channels for CSS vars |
| `getBreakdownValue(matchers)` | Extract normalized display value from breakdown items |
| `normalizeHotlistWorkType(value)` | Normalize hotlist work type strings |

---

## UI Layout & Components

### AppNav
Top navigation bar with global nav (Jobs, Hotlist, Pulse, Inbox, Tracker).

### Category Pills (Desktop)
- Horizontal scrollable category buttons with vendor + job count badges.
- Selecting a category reveals its tech-stack sub-filter pills.

### Search & Filter Row
- **Search input**: natural-language search with recent-search dropdown.
- **Desktop tabs**: Recent / Revealed / Asked / Verified with counts.
- **Feed time basis toggle**: Posted vs Created (only for `poornapotluri27@gmail.com`).
- **Range picker**: 24h / 3d / 7d / 15d / 30d dropdown.
- **Refresh button**: reloads feed.

### Match Feed
- **Mobile**: single-column card list with infinite scroll.
- **Desktop**: 3-column masonry layout with card palette cycling.
- **Lead cards** show:
  - Title (with palette-accent color)
  - `Posted/Added x ago` + masked poster name + company + platform
  - Ask AI button (top-right): `Ask` / `Asked` / `Verified` states
  - 6-cell detail grid: Exp, Work Type, Emp Type, Rate, Visa, Location
  - Skills row (blurred until breakdown is expanded)
  - Action buttons: Reveal (costs credits) / Breakdown / View

### Pull-to-Refresh (Mobile)
- Touch-based pull gesture with `pullDistance` state and release-to-refresh indicator.

### Ask AI Preview Modal
- Shows generated email subject + content
- Allows editing (must be under 40 words)
- Pitching / Request Details tabs via `EmailDraftTabId`

### Lead Detail Modal
- Full job details + score breakdown table
- Copy Email / Copy Phone buttons (revealed only)
- Generate Email (auto-generated pitch draft)

---

## Feature Details

### Natural-Language Search
The search bar is the primary filter mechanism. It:
1. Parses employment type tokens (`C2C`, `W2`, `1099`, `full-time`, `contract`).
2. Parses work type tokens (`remote`, `hybrid`, `onsite`).
3. Parses visa tokens (`USC`, `GC`, `H1B`, `EAD`, `OPT`, `CPT`, `TN`).
4. Parses rate ranges (`$45-$60`, `$45/hr`).
5. Treats the remainder as a role query.

### Vector Search (Optional)
When a query is applied, the page can also run a vector similarity search using `role_embedding` on `hotlist_ai_roles` against `job_embedding` on `social_jobs` (via an RPC). Results are intersected with the regular feed.

### Recent Searches
- Stored in `pulse_search_history` scoped to page (`/jobs`).
- A dropdown of recent searches appears when the input is focused.

### Ask AI (Vendor Email Requests)
- For jobs, the AI analyzes the lead and identifies **missing details** (e.g., rate, visa, location).
- The `ask-ai-vendor-email` edge function generates an email requesting those details and sends it to the vendor.
- The request creates a `vendor_conversation` → appears in the **Inbox** page.
- Card state shows: `Ask` (available), `Asked` (pending), `Verified` (fulfilled via `get_pulse_asked_job_states`).

### Card Palette
A `CARD_PALETTE` array cycles through colored card themes by row/column position so adjacent cards never share a tone. The accent color is applied via CSS variables (`--accent-rgb`, `--accent-hex`) for buttons and title tones.

### Reveal Names Count
The page aggregates how many recruiters revealed each lead (`PulseRevealNamesRow`) and shows a count badge on cards.

### Vendor Auto-Sync
When a user reveals contact info from a job lead, a vendor record is created/updated in the `vendors` table so it appears in the Tracker page.

---

## Credit System

| Action | Cost | What Happens |
|--------|------|-------------|
| Reveal Contact | **$0.10** | Unmasks name/email/phone; syncs vendor to Tracker |
| Breakdown | **$0.10** | Shows detailed AI scoring table |
| Ask AI email | `ASK_AI_COST` in edge function (0.01) | Generates + sends vendor email request |

Credits are consumed via `consume_feature_credit` RPC with a legacy fallback that directly updates `accounts.credits_balance` and logs to `credit_transactions`. On insufficient balance, a toast is shown.

---

## Database Tables & RPCs Used

| Object | Operations | Purpose |
|--------|-----------|---------|
| `social_jobs` | SELECT | Scraped job postings source |
| `radar_match_results` | SELECT | Pre-computed AI match scores |
| `pulse_lead_actions` | SELECT, UPSERT | Track reveal/breakdown actions |
| `hotlist_ai_roles` | SELECT, INSERT, UPDATE | Role watching state & settings |
| `vendors` | SELECT, UPSERT | Auto-sync revealed contacts to Tracker |
| `accounts` | SELECT | Account context, credits balance |
| `account_members` | SELECT | Membership display names |
| `credit_transactions` | INSERT | Usage log entries |
| `pulse_search_history` | INSERT, SELECT | Recent search history |
| `asked_job_details` | SELECT | Global asked/verified state |
| `social_hotlist_requests` | SELECT | Hotlist resume request state |
| `get_pulse_persona_leaderboard` | RPC | Leaderboard with watcher counts |
| `get_pulse_social_feed` | RPC | Global social feed |
| `get_pulse_social_feed_page` | RPC | Keyset-paginated social feed |
| `get_pulse_asked_job_states` | RPC | Asked/verified state |
| `consume_feature_credit` | RPC | Credit deduction |

### Row-Level Security
All tables use RLS policies scoped to the user's account via `account_members`. The feed uses SECURITY DEFINER RPCs so authenticated users can read the global cross-account feed while still being restricted from direct table access.

---

## Dependencies

| Dependency | Usage |
|------------|-------|
| `react`, `react-router-dom` | Core framework, navigation, URL params (`useSearchParams`) |
| `lucide-react` | 40+ icons (Briefcase, UserRound, Activity, Mail, FileText, Mail, Building2, etc.) |
| `AppNav` | Top navigation bar |
| `Toast` | Notification toasts |
| `LogoSpinner` | Loading spinner |
| `useAuth` | Authentication context (user, account, credits) |
| `useTheme` | Dark mode styling |
| `supabase` | Database client + edge function invocation |
| `HOTLIST_AI_SUGGESTIONS` | Seed role suggestions |
| `buildScoreBreakdownDisplayItems` | Score breakdown display formatting |
| `matchesPulseFeedSearch` | Feed search matching |
| `pulse-feed-cache` worker | Edge-cached feed rows (via env URL + token) |
| `ask-ai-vendor-email` edge function | AI email generation + sending |