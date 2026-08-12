# Pulse Page — Technical Documentation

> **File**: `src/pages/ProfilesPage.tsx` (~3,570 lines)
> **Route**: `/pulse`
> **Purpose**: The Market Pulse directory — a market-intelligence dashboard that ranks technology role profiles (personas) by market activity (unique hotlists, jobs, and vendors) within a 30-day window. Users browse role profiles by category, search, and click through to the Jobs (`/jobs`) or Hotlist (`/hotlist`) feeds pre-filtered by the selected role. Supports one-click "watch" that syncs a role into the user's watchlist and bench profiles.

> **⚠️ Note on naming**: Historically, the "Pulse" terminology was applied to the lead-matching feed engine in `PulsePage.tsx`. In the current routing, `/pulse` renders **`ProfilesPage.tsx`** (the Market Pulse directory), while `/jobs` and `/hotlist` render `PulsePage.tsx`. See `docs/jobs-page-documentation.md` and `docs/hotlist-page-documentation.md` for the feed pages.

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

The Pulse page is a **market directory** that shows:

- A **role leaderboard** (personas) ranked by market activity within a 30-day window.
- Per-role **market stats**: unique hotlists, unique jobs, unique vendors, and average rate.
- **Category tabs** (All, Front-End, Backend, Data, Security, CRM, QA, Biz Dev, AI, ML, DevOps) with **tech-stack sub-filters**.
- A **domain table** aggregating market activity by technology category.
- **Watch** action that syncs a role into the user's `watchlist_profiles` and creates a bench profile in `profiles`.
- **Deep-links** to the Jobs (`/jobs?q=<role>`) and Hotlist (`/hotlist?q=<role>`) feeds pre-filtered by role.

The page is optimized for **fast initial load** via a 30-day directory read-model (`pulse_directory_30d`) cached in `localStorage` (6-hour TTL), with a vector-similarity fallback for stats.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          AppNav (top bar)                        │
├──────────────────────────────────────────────────────────────────┤
│  Category Pills (desktop, vendor + job counts)                   │
├──────────────────────────────────────────────────────────────────┤
│  Tech-stack sub-filter pills (when a category is selected)       │
├──────────────────────────────────────────────────────────────────┤
│  Search (profiles) | Range | Last-refreshed | Refresh            │
│  Mobile: search pill + range menu + refresh icon                 │
├──────────────────────────────────────────────────────────────────┤
│  Desktop (2-col)          │  Mobile (stacked)                    │
│  ┌─────────────────────┐  │  ┌──────────────────────┐           │
│  │ Profiles Table      │  │  │ Domains Table        │           │
│  │ Role|Rate|Hot|Jobs  │  │  │ (150px scroll)       │           │
│  │ |Vendors            │  │  └──────────────────────┘           │
│  └─────────────────────┘  │  ┌──────────────────────┐           │
│  ┌─────────────────────┐  │  │ Profiles Table       │           │
│  │ Domains Table       │  │  │ (infinite scroll)    │           │
│  └─────────────────────┘  │  └──────────────────────┘           │
├──────────────────────────────────────────────────────────────────┤
│  Modals: Lead detail + score breakdown + email drafts            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `pulse_directory_30d` | Materialized 30-day directory read-model (personas + market stats) |
| `radar_match_hotlist` | Pre-computed hotlist match scores (for hotlist counts + avg rate) |
| `radar_match_results` | Pre-computed social job match scores (for job/vendor counts) |
| `social_jobs` | Scraped job postings (fallback stat source) |
| `hotlist_ai_roles` | User's watched roles (watch state + fallback leaderboard) |
| `watchlist_profiles` | User's watchlist (primary watch state source) |
| `profiles` | Bench profiles (created when a role is watched) |
| `radar_match_results` | Vector similarity stats source |
| `accounts` | Account context |

### Supabase RPCs

| RPC | Purpose |
|-----|---------|
| `get_pulse_persona_leaderboard` | Aggregated leaderboard with watcher counts |
| `refresh_pulse_directory_30d_snapshot` | Force-refresh the 30-day directory read-model |
| `get_profile_stats_by_vector` | Vector-similarity stats (role_embedding ↔ job_embedding) |
| `get_pulse_social_feed` | Global social feed (fallback stat source) |
| `consume_feature_credit` | Deduct credits for reveal/breakdown |

---

## Types & Interfaces

### `PulsePersona`
A role profile on the directory board.

| Field | Type | Description |
|-------|------|-------------|
| `target_role` | `string` | Role title (e.g., "Senior Full Stack Engineer") |
| `summary` | `string` | One-line description |
| `active_watchers` | `number` | Count of users watching this role |
| `avatar_url` | `string \| null` | Profile avatar URL |
| `rank` | `number` | Leaderboard position |
| `min_years_exp` / `max_years_exp` | `number \| null` | Experience range |
| `visa_status` | `string \| null` | e.g., "H1B", "US Citizen", "GC" |
| `employment_type` | `string \| null` | e.g., "C2C", "W2", "1099" |
| `work_type` | `string \| null` | "Remote", "Hybrid", "Onsite" |
| `preferred_locations` | `string \| null` | Comma-separated locations |
| `min_rate_usd_per_hr` / `max_rate_usd_per_hr` | `number \| null` | Rate range |
| `priority_skills` | `string \| null` | Comma-separated skills |
| `relocation_open` | `boolean \| null` | Relocation open to |

### `ProfileStats`
Per-role market stats.

| Field | Type | Description |
|-------|------|-------------|
| `uniqueCompanies` | `number` | Unique companies |
| `uniqueVendors` | `number` | Unique vendors |
| `uniqueHotlists` | `number` | Unique hotlists |
| `uniqueJobs` | `number` | Unique jobs |
| `avgRate` | `number \| null` | Average hourly rate |
| `avgMatchScore` | `number \| null` | Average match score |

### `PulseDirectorySnapshot`
The localStorage cache shape.

| Field | Type |
|-------|------|
| `cachedAt` | `number` |
| `rangeId` | `'30d'` |
| `leaderboard` | `PulsePersona[]` |
| `stats` | `Record<string, ProfileStats>` |

### `PulseDirectoryReadModelRow`
A row from the `pulse_directory_30d` table (persona + `unique_hotlists`, `unique_jobs`, `unique_vendors`, `avg_rate`, `refreshed_at`).

### `DomainLeaderboardRow`
Aggregated category stats (`id`, `label`, `icon`, `rank`, `uniqueHotlists`, `uniqueJobs`, `uniqueVendors`).

### Other Types
- **`PulseSocialFeedRpcRow`** — Raw feed row from `get_pulse_social_feed`
- **`SocialJobRow`** — Raw `social_jobs` table row
- **`MatchesTabId`** — `'all' | 'breakdown' | 'revealed' | 'queued'`
- **`LeadActionType`** — `'revealed' | 'breakdown'`
- **`ProfileRangeOption`** — `{ id, label, hours }` for time range
- **`ProfileCategoryTab`** — Category tab config with icon

---

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `LEADERBOARD_RPC_LIMIT` | `500` | Max roles from leaderboard RPC |
| `FEED_WINDOW_HOURS` | `48` | Feed window (fallback stat source) |
| `PULSE_ROWS_CACHE_TTL_MS` | `30_000` | In-memory feed cache TTL |
| `PULSE_DIRECTORY_CACHE_KEY` | `'profilepush:pulse-directory:v2:30d'` | localStorage key |
| `PULSE_DIRECTORY_CACHE_TTL_MS` | `6 * 60 * 60 * 1000` | 6-hour directory cache TTL |
| `MOBILE_ROLES_BATCH_SIZE` | `30` | Mobile infinite-scroll batch |
| `MATCHES_PAGE_SIZE` | `5` | Matches page size |
| `REVEAL_CONTACT_COST` | `0.25` | Credits to reveal contact |
| `BREAKDOWN_COST` | `0.1` | Credits to view breakdown |

### `PROFILE_RANGE_OPTIONS`
Time ranges: 24h, 3d, 7d, 15d, 30d (default `30d`).

### `PROFILE_CATEGORY_TABS`
11 category tabs with icons and per-category accent colors.

### `CATEGORY_TECH_STACKS`
Per-category tech-stack sub-filters (e.g. Front-End → React, Angular, Vue…).

### `DEFAULT_PERSONA_AVATARS`
Maps role keywords to Unsplash avatar URLs; fallback to stable pravatar URLs via `getStablePortraitUrl(seed)`.

### `zeroStats`
Default `ProfileStats` object (all zeros, null rates).

---

## State Management

### Core Data State

| Variable | Type | Purpose |
|----------|------|---------|
| `initialDirectorySnapshot` | `PulseDirectorySnapshot \| null` | Snapshot read from localStorage on mount |
| `loading` | `boolean` | Initial load state (false if fresh snapshot exists) |
| `refreshing` | `boolean` | Directory refresh state |
| `leaderboard` | `PulsePersona[]` | All personas |
| `watchingRoles` | `Set<string>` | Normalized watched role names |
| `activePersona` | `PulsePersona \| null` | Selected persona |
| `feed` | `SocialLead[]` | Matched leads (for inline display) |
| `profileStatsByRole` | `Record<string, ProfileStats>` | Market stats per role |
| `directoryCachedAt` | `number \| null` | Directory cache timestamp |

### Filters & UI

| Variable | Type | Purpose |
|----------|------|---------|
| `profileRangeId` | `ProfileRangeOption['id']` | Time range (default `30d`) |
| `selectedCategoryId` | `string` | Active category (default `all`) |
| `selectedTechStacks` | `string[]` | Active tech-stack sub-filter |
| `profileSearchQuery` | `string` | Profile search query |
| `feedSearchQuery` | `string` | Feed search query |
| `feedSearchScope` | `PulseFeedSearchScope` | Feed search scope |
| `view` | `'board' \| 'feed'` | Mobile view toggle |
| `mobileVisibleRolesCount` | `number` | Mobile infinite-scroll cursor |
| `isMobileViewport` | `boolean` | Responsive breakpoint state |

### Action Tracking

| Variable | Type | Purpose |
|----------|------|---------|
| `revealedLeadIds` | `Set<string>` | Revealed lead IDs |
| `breakdownChargedLeadIds` | `Set<string>` | Breakdown-charged lead IDs |
| `queuedLeadIds` | `Set<string>` | Queued lead IDs |
| `selectedLead` | `SocialLead \| null` | Lead detail modal |
| `showBreakdown` | `boolean` | Whether breakdown is shown in modal |
| `generatedEmailDraft` | `string` | Generated email draft |
| `showGeneratedEmailDraft` | `boolean` | Email draft visibility |

---

## Data Flow & Lifecycle

### 1. Initial Load (`useEffect` on mount)

```
loadInitial()
  ├── readPulseDirectorySnapshot() from localStorage
  │     └── If fresh (≤6h) → use cached leaderboard/stats, skip loading
  ├── If not fresh → loadDirectoryReadModel()
  │     └── SELECT pulse_directory_30d ORDER BY rank
  │           └── Build leaderboard + stats + writePulseDirectorySnapshot()
  ├── If read-model fails → loadLeaderboard() (RPC + fallback)
  ├── loadWatchingRoles() → watchlist_profiles (then hotlist_ai_roles fallback)
  ├── loadLeadActionState() → pulse_lead_actions
  └── get_pulse_social_feed (limit 1) → set lastMatchAt
```

### 2. Stats Loading

```
loadProfileStats()
  ├── If profileRangeId === '30d' → check localStorage snapshot (fresh?)
  ├── Load radar_match_hotlist + radar_match_results (last N hours)
  │     └── Compute hotlist counts + avg rates per role
  ├── Primary: get_profile_stats_by_vector RPC (role_embedding ↔ job_embedding)
  │     └── If success → commit stats (jobs, vendors, hotlists, avgRate)
  └── Fallback: loadGlobalPulseRows() → text-based roleMatchesPersona()
        └── Compute companies, vendors, jobs, matchScore per role
```

### 3. Watch Activation

```
activatePersona(persona)
  ├── syncWatchlistProfileFromHotlistRole(persona)
  │     ├── Find matching hotlist_ai_roles (ILike target_role)
  │     ├── If none → create via buildHotlistRolePayloadFromPersona()
  │     └── Upsert into watchlist_profiles (buildWatchlistPayloadFromRole)
  ├── ensureBenchProfileForWatchedRole(persona)
  │     └── If no profiles row → insert "{role} Watch Profile"
  ├── setWatchingRoles + setActivePersona + setView('feed')
  ├── loadFeed(null) + loadLeaderboard()
  └── Toast "Watching {role}"
```

### 4. Deep-Link Navigation

```
openJobsForRole(role)   → navigate(`/jobs?q=${encodeURIComponent(role)}`)
openHotlistForRole(role) → navigate(`/hotlist?q=${encodeURIComponent(role)}`)
```

### 5. Directory Refresh

```
refreshDirectory()
  ├── Remove localStorage cache
  ├── loadDirectoryReadModel(true) → refresh_pulse_directory_30d_snapshot RPC
  ├── If fails → loadProfileStats(true)
  └── Toast "30-day Pulse numbers refreshed"
```

---

## Core Functions

### Leaderboard & Directory

| Function | Purpose |
|----------|---------|
| `readPulseDirectorySnapshot()` | Read localStorage directory snapshot |
| `writePulseDirectorySnapshot(leaderboard, stats)` | Write snapshot to localStorage |
| `loadLeaderboard()` | Fetch leaderboard via RPC + merge fallback roles |
| `loadDirectoryReadModel(forceRefresh?)` | Load `pulse_directory_30d` read-model |
| `loadInitial()` | Bootstrap page (snapshot → read-model → leaderboard) |
| `buildSeedLeaderboard()` | Create initial leaderboard from 10 seed suggestions |
| `buildFallbackLeaderboardFromRoles(rows)` | Aggregate `hotlist_ai_roles` into personas |
| `buildHotlistRolePayloadFromPersona(accountId, persona)` | Payload for creating a hotlist role |
| `buildWatchlistPayloadFromRole(accountId, role, userId?)` | Payload for watchlist upsert |

### Stats

| Function | Purpose |
|----------|---------|
| `loadProfileStats(forceRefresh?)` | Compute per-role market stats (vector + fallback) |
| `getProfileStatsByVector(targetRoles)` | Vector-similarity stats RPC |
| `commitStats(stats)` | Set stats + write snapshot (for 30d) |

### Watch & Sync

| Function | Purpose |
|----------|---------|
| `ensureBenchProfileForWatchedRole(persona)` | Create bench profile if missing |
| `syncWatchlistProfileFromHotlistRole(persona)` | Create/upsert hotlist role + watchlist profile |
| `activatePersona(persona)` | Full watch flow (sync + bench + state) |

### Navigation

| Function | Purpose |
|----------|---------|
| `openJobsForRole(role)` | Navigate to `/jobs?q=<role>` |
| `openHotlistForRole(role)` | Navigate to `/hotlist?q=<role>` |
| `refreshFeed()` | Reload feed + lastMatchAt |

### Credits & Actions

| Function | Purpose |
|----------|---------|
| `consumeCredits(amount, feature, metadata)` | Deduct via RPC with legacy fallback |
| `consumeCreditsLegacy(amount, feature)` | Legacy direct balance update |
| `persistLeadAction(leadId, actionType)` | Upsert into `pulse_lead_actions` |
| `handleRevealContact(lead)` | Reveal contact + save vendor to Tracker |
| `handleOpenBreakdown(lead)` | Charge + display AI breakdown |

### Display Helpers

| Function | Purpose |
|----------|---------|
| `normalize(text)` | Lowercase + trim + collapse whitespace |
| `canonicalizeRoleForUniqueness(role)` | Strip seniority prefixes |
| `getPersonaBucket(role)` | Bucket role into canonical persona |
| `getPersonaSkillList(role, skills?)` | Parse skills or infer from suggestions |
| `getPersonaDetailColumns(persona)` | Extract detail columns |
| `inferRoleCategoryId(role)` | Match role to category via regex |
| `roleMatchesPersona(row, role, skills)` | Check if a job matches a persona |
| `getMetricHeatmapColor(value, max)` | Heatmap color for metric cells |
| `getMarketPulseVisual(uniqueJobs)` | Map job count to High/Med/Low pulse level |
| `getScoreVisual(score)` | Card tone/badge from match score |
| `generateEmailDraft(lead)` | Build a pitching email draft |
| `maskPosterName(name)` | Privacy mask poster name |

---

## UI Layout & Components

### AppNav
Top navigation bar with global nav.

### Category Pills (Desktop)
- 11 category buttons with vendor + job count badges.
- Selecting reveals tech-stack sub-filter pills.

### Search & Filter Row
- **Profile search**: filters by role, summary, skills, location, visa, employment type, work type, experience, rate.
- **Range picker**: 24h / 3d / 7d / 15d / 30d (default 30d).
- **Last-refreshed** timestamp.
- **Refresh button**: reloads stats + feed.

### Profiles Table
Sortable table with heatmap-colored metric cells:

| Column | Content |
|--------|---------|
| Role | Role title (blue, clickable) + ChevronRight |
| Rate | Avg hourly rate (`$XX` heatmapped) |
| Hotlist | Unique hotlist count (clickable → `/hotlist?q=`) |
| Jobs | Unique job count |
| Vendors | Unique vendor count |

- Clicking a **Role** row → `openJobsForRole()` (navigates to `/jobs?q=`).
- Clicking the **Hotlist** cell → `openHotlistForRole()` (navigates to `/hotlist?q=`).

### Domains Table
Aggregates market activity by technology category (Domain, Hotlist, Jobs, Vendors). Clicking a domain sets the category filter.

### Mobile Layout
- **Domains Table** (fixed 150px scroll) on top.
- **Profiles Table** below with infinite scroll (30-per-batch).
- Sticky search/filter bar with range menu.

### Lead Detail Modal
- Full lead details + score breakdown table (Rule / Profile / Job columns).
- Actions: **Generate Email**, **Copy Email ID**, **Copy Phone** (revealed only).
- Editable generated email draft textarea.

---

## Feature Details

### 30-Day Directory Read-Model
The page is backed by a materialized `pulse_directory_30d` table that pre-computes the leaderboard and per-role stats. This enables near-instant initial render:
- Snapshot cached in `localStorage` (`profilepush:pulse-directory:v2:30d`) with a 6-hour TTL.
- `refresh_pulse_directory_30d_snapshot` RPC force-refreshes the read-model.
- If the read-model is unavailable, the page falls back to the leaderboard RPC + live stats.

### Market Pulse Visualization
Each role shows a **Market Pulse** level (High/Med/Low) derived from the unique job count:
- ≥15 jobs → **High** (emerald)
- ≥6 jobs → **Medium** (amber)
- <6 jobs → **Low** (red)

### Vector-Similarity Stats
`get_profile_stats_by_vector` RPC uses `hotlist_ai_roles.role_embedding` ↔ `social_jobs.job_embedding` (cosine similarity, threshold 0.65) to compute unique job/vendor counts per role. This is the **primary** stats path; a text-based `roleMatchesPersona` fallback handles RPC unavailability.

### Heatmap Metrics
Metric cells (Rate, Hotlist, Jobs, Vendors) are colorized using `getMetricHeatmapColor()` on a 6-color palette (`#C084FC → #34D399`) relative to the max value in view.

### One-Click Watch
Clicking **Watch** on a persona:
1. Creates/updates a `hotlist_ai_roles` row (if missing).
2. Upserts a `watchlist_profiles` row (is_watching=true).
3. Creates a bench `profiles` row ("{Role} Watch Profile") if missing.
4. Sets the persona active and loads the feed.

### Deep Links to Jobs / Hotlist
- Role row click → `/jobs?q=<role>`
- Hotlist cell click → `/hotlist?q=<role>`

These URLs are consumed by `PulsePage.tsx` (via `useSearchParams`) to pre-filter the feed.

### Directive / Lead Modal
The page includes a lead-detail modal (accessible from the feed view) with:
- AI score breakdown table
- Email-draft generation (pitching email)
- Copy Email / Copy Phone (revealed only)

---

## Credit System

| Action | Cost | What Happens |
|--------|------|-------------|
| Reveal Contact | **$0.25** | Unmasks name/email/phone; syncs vendor to Tracker |
| Breakdown | **$0.10** | Shows detailed AI scoring table |

> Note: The reveal cost here is `$0.25`, which differs from the Jobs/Hotlist feed pages (`$0.10`).

---

## Database Tables & RPCs Used

| Object | Operations | Purpose |
|--------|-----------|---------|
| `pulse_directory_30d` | SELECT | 30-day directory read-model |
| `radar_match_hotlist` | SELECT | Hotlist counts + avg rate |
| `radar_match_results` | SELECT | Job/vendor counts + fallback |
| `social_jobs` | SELECT | Fallback stat source |
| `hotlist_ai_roles` | SELECT, INSERT, UPDATE | Watch state + fallback leaderboard |
| `watchlist_profiles` | SELECT, INSERT, UPSERT | User watchlist |
| `profiles` | SELECT, INSERT | Bench profiles (watch sync) |
| `accounts` | SELECT | Account context |
| `get_pulse_persona_leaderboard` | RPC | Leaderboard with watcher counts |
| `refresh_pulse_directory_30d_snapshot` | RPC | Force-refresh directory read-model |
| `get_profile_stats_by_vector` | RPC | Vector-similarity stats |
| `get_pulse_social_feed` | RPC | Global social feed (fallback) |
| `consume_feature_credit` | RPC | Credit deduction |

### Row-Level Security
All tables use RLS policies scoped to the user's account via `account_members`. The directory read-model and feed RPCs are SECURITY DEFINER so authenticated users can read global cross-account market data while direct table access remains restricted.

---

## Dependencies

| Dependency | Usage |
|------------|-------|
| `react`, `react-router-dom` | Core framework, navigation, URL params (`useSearchParams`, `useNavigate`) |
| `lucide-react` | 40+ icons (Activity, Briefcase, Building2, UserRound, Handshake, DollarSign, Radar, etc.) |
| `AppNav` | Top navigation bar |
| `Toast` | Notification toasts |
| `LogoSpinner` | Loading spinner |
| `useAuth` | Authentication context (user, account, credits) |
| `useTheme` | Dark mode styling |
| `supabase` | Database client + RPC invocation |
| `HOTLIST_AI_SUGGESTIONS` | Seed role suggestions |
| `buildScoreBreakdownDisplayItems` | Score breakdown display formatting |
| `matchesPulseFeedSearch` | Feed search matching |