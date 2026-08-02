# Pulse Page — Technical Documentation

> **File**: `src/pages/PulsePage.tsx` (~1,228 lines)
> **Route**: `/pulse`
> **Purpose**: AI-powered social job lead matching feed for bench sales recruiters. Monitors social media platforms for job postings, matches them against watched role profiles, and surfaces actionable leads with contact details.

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
11. [Database Tables Used](#database-tables-used)
12. [Credit System](#credit-system)
13. [Dependencies](#dependencies)

---

## Overview

The Pulse page is the primary matching engine UI for ProfilePush. It operates as a two-panel layout:

- **Left panel (Profiles Board)**: A leaderboard of role profiles (personas) the user watches, organized by technology category. Each persona aggregates job matches from social platforms.
- **Right panel (Matches Feed)**: A scrollable feed of social job leads matching the currently selected persona, with actions to reveal contact info, view AI score breakdowns, and queue leads.

The page pulls data from multiple Supabase tables and RPCs, deduplicates results, and presents them with privacy-masked contact info that costs credits to reveal.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          AppNav (top bar)                        │
├───────────────────────────────────────┬──────────────────────────┤
│          Category Tabs (horizontal)   │                          │
├───────────────────────────────────────┤                          │
│  Search + Time Range + Refresh        │   Matches Tabs           │
├───────────────────────────────────────┤  (All/Breakdown/         │
│                                       │   Revealed/Queued)       │
│  Profiles Table                       ├──────────────────────────┤
│  ┌─ Watching section ──────────────┐  │                          │
│  │  Watched personas (sorted)      │  │  Match Cards             │
│  └─────────────────────────────────┘  │  ┌────────────────────┐  │
│  ┌─ Top Profiles section ──────────┐  │  │ Job Title           │  │
│  │  Other personas (ranked)        │  │  │ Company • Location  │  │
│  └─────────────────────────────────┘  │  │ Platform badge      │  │
│                                       │  │ Poster • Time ago   │  │
│                                       │  │ [Breakdown][Reveal]  │  │
│                                       │  └────────────────────┘  │
│                                       │  ... more cards ...      │
│                                       │  [Load More]             │
└───────────────────────────────────────┴──────────────────────────┘
```

---

## Data Model

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `hotlist_ai_roles` | User's watched roles with settings (frequency, active status, avatar, detail fields) |
| `social_jobs` | Scraped social media job postings (LinkedIn, Facebook, Dice, Indeed, etc.) |
| `radar_match_results` | AI-computed match scores between profiles and jobs |
| `pulse_lead_actions` | Tracks user actions on leads (revealed, breakdown) |
| `accounts` / `account_members` | Multi-tenant account system |
| `vendors` | Auto-populated vendor records from revealed leads |

### Supabase RPCs

| RPC | Purpose |
|-----|---------|
| `get_pulse_persona_leaderboard` | Aggregated leaderboard with watcher counts |
| `consume_feature_credit` | Deduct credits for reveal/breakdown actions |

---

## Types & Interfaces

### `PulsePersona`
The core display type for a role profile on the board.

| Field | Type | Description |
|-------|------|-------------|
| `target_role` | `string` | Role title (e.g., "Senior Full Stack Engineer") |
| `summary` | `string` | One-line description of the role |
| `active_watchers` | `number` | Count of users watching this role |
| `avatar_url` | `string \| null` | Profile avatar URL |
| `rank` | `number` | Leaderboard position |
| `min_years_exp` | `number \| null` | Minimum years of experience |
| `max_years_exp` | `number \| null` | Maximum years of experience |
| `visa_status` | `string \| null` | e.g., "H1B", "US Citizen", "GC" |
| `employment_type` | `string \| null` | e.g., "C2C", "W2", "1099" |
| `work_type` | `string \| null` | "Remote", "Hybrid", "Onsite" |
| `preferred_locations` | `string \| null` | Comma-separated locations |
| `min_rate_usd_per_hr` | `number \| null` | Min hourly rate |
| `max_rate_usd_per_hr` | `number \| null` | Max hourly rate |
| `priority_skills` | `string \| null` | Comma-separated skill list |
| `relocation_open` | `boolean \| null` | Whether open to relocation |

### `SocialLead`
A matched job lead displayed in the feed.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Social job ID |
| `title` | `string` | Job title |
| `location` | `string` | Job location |
| `company` | `string` | Company name |
| `posterName` | `string` | Name of person who posted |
| `posterEmail` | `string` | Poster's email (revealed on action) |
| `posterPhone` | `string` | Poster's phone (revealed on action) |
| `postedAt` | `string` | ISO timestamp |
| `postedAgo` | `string` | Human-readable time ago |
| `platform` | `string` | Source platform (LinkedIn, Dice, etc.) |
| `matchScore` | `number \| null` | AI match score (0–100) |
| `profileId` | `string \| null` | Linked profile ID |
| `scoreBreakdown` | `Record<string, unknown> \| null` | Detailed score breakdown |

### `HotlistRoleRow`
Database row from `hotlist_ai_roles`.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `target_role` | `string` | Role being watched |
| `account_id` | `string` | Owner account |
| `avatar_url` | `string \| null` | Custom avatar |
| `category` | `string \| null` | Role category |
| `is_active` | `boolean` | Whether actively watching |
| `schedule_frequency` | `string` | Scraping frequency |

### Other Types

- **`FallbackRoleRow`** — Extended role row with demographic fields for building leaderboard from DB
- **`SocialJobRow`** — Raw social_jobs table row
- **`RadarSocialMatchRow`** — Match result with scores
- **`ProfileStats`** — Counts of companies, vendors, and jobs per role
- **`ProfileRangeOption`** — Time range filter config (`{ id, label, hours }`)
- **`ProfileCategoryTab`** — Category tab config (`{ id, label, icon, pattern }`)
- **`MatchesTabId`** — `'all' | 'breakdown' | 'revealed' | 'queued'`
- **`LeadActionType`** — `'revealed' | 'breakdown'`
- **`PulseLeadActionRow`** — `{ lead_id, action_type }`

---

## Constants

### `LEADERBOARD_RPC_LIMIT = 500`
Max roles fetched from the leaderboard RPC.

### `FEED_WINDOW_HOURS = 48`
Time window (in hours) for fetching social job matches.

### `TOP_PROFILES_PAGE_SIZE = 100`
Page size for the top profiles section.

### `MATCHES_PAGE_SIZE = 10`
Number of match cards shown before "Load More" pagination.

### `PROFILE_RANGE_OPTIONS`
Time range filters: 1h, 24h, 48h, 3d.

### `PROFILE_CATEGORY_TABS`
10 technology categories with icons and regex patterns for role classification:

| Category | Icon | Pattern Example |
|----------|------|-----------------|
| Front-End | `Code2` | `react\|angular\|vue\|front.?end\|ui/ux` |
| Backend | `Server` | `backend\|java\|node\|python\|go\|ruby\|\.net\|api` |
| Data | `Database` | `data\|analytics\|etl\|sql\|spark\|warehouse` |
| Security | `Shield` | `security\|soc\|iam\|cyber\|penetration` |
| CRM | `Handshake` | `salesforce\|crm\|hubspot\|dynamics` |
| QA | `CheckSquare` | `qa\|quality\|test\|sdet\|automation` |
| Biz Dev | `Briefcase` | `product\|business\|analyst\|scrum\|project` |
| AI | `Sparkles` | `ai\|artificial\|nlp\|generative\|llm\|gpt` |
| ML | `Brain` | `machine.learn\|ml\|deep.learn\|model` |
| DevOps | `Cloud` | `devops\|cloud\|infra\|sre\|platform\|kubernetes` |

### `PERSONA_SUMMARY_BY_ROLE`
Map of role titles to pre-written summaries.

### `DEFAULT_PERSONA_AVATARS`
Map of role keywords to Pravatar avatar URLs.

---

## State Management

### Core Data State

| Variable | Type | Purpose |
|----------|------|---------|
| `leaderboard` | `PulsePersona[]` | All personas on the board |
| `watchingRoles` | `Set<string>` | Normalized names of roles user is watching |
| `activePersona` | `PulsePersona \| null` | Currently selected persona |
| `feed` | `SocialLead[]` | Matched leads for active persona |
| `feedLoading` | `boolean` | Feed loading state |
| `profileStatsByRole` | `Record<string, ProfileStats>` | Vendor/company/job stats per role |

### User Action Tracking

| Variable | Type | Purpose |
|----------|------|---------|
| `revealedLeadIds` | `Set<string>` | Lead IDs where contact was revealed |
| `breakdownChargedLeadIds` | `Set<string>` | Lead IDs where breakdown was charged |
| `queuedLeadIds` | `Set<string>` | Lead IDs queued for later |

### UI State

| Variable | Type | Purpose |
|----------|------|---------|
| `view` | `'board' \| 'feed'` | Mobile view toggle |
| `profileRangeId` | `string` | Selected time range |
| `selectedCategoryId` | `string \| null` | Active category filter |
| `profileSearchQuery` | `string` | Profile search input |
| `selectedMatchesTab` | `MatchesTabId` | Active matches tab |
| `selectedLead` | `SocialLead \| null` | Lead detail modal |
| `visibleMatchesCount` | `number` | Pagination cursor for matches |

---

## Data Flow & Lifecycle

### 1. Initial Load (`useEffect` on mount)

```
loadLeaderboard() → get_pulse_persona_leaderboard RPC
  ├── Success → merge with DB roles → set leaderboard
  └── Fallback → hotlist_ai_roles query → buildFallbackLeaderboardFromRoles()
                                        → merge with HOTLIST_AI_SUGGESTIONS

loadWatchState() → hotlist_ai_roles WHERE is_active=true
  └── Set watchingRoles

loadLeadActionState() → pulse_lead_actions WHERE action_type IN ('revealed','breakdown')
  └── Set revealedLeadIds, breakdownChargedLeadIds
```

### 2. Persona Selection

```
User clicks persona row
  └── setActivePersona(persona)
      └── useEffect triggers loadFeed(persona)
          ├── radar_match_results WHERE profile target_role matches
          │   └── Hydrate with social_jobs data
          └── social_jobs direct query (fallback/supplement)
              └── Deduplicate → sort by score/date → set feed
```

### 3. Match Card Actions

```
User clicks "Reveal"
  ├── chargeCredits(1, 'reveal')
  │   └── consume_feature_credit RPC
  ├── persistLeadAction(leadId, 'revealed')
  │   └── UPSERT into pulse_lead_actions
  ├── saveVendorToTracker(lead)
  │   └── UPSERT into vendors table
  └── Update revealedLeadIds state

User clicks "Breakdown"
  ├── chargeCredits(1, 'breakdown')
  ├── persistLeadAction(leadId, 'breakdown')
  └── Update breakdownChargedLeadIds state
```

### 4. Profile Stats Loading

```
loadProfileStats() → radar_match_results within time window
  └── Join with social_jobs
      └── Aggregate unique companies, vendors, job count per role
          └── Set profileStatsByRole
```

---

## Core Functions

### Normalization & Display

| Function | Purpose |
|----------|---------|
| `normalize(input)` | Lowercase, trim, collapse whitespace |
| `canonicalizeRoleForUniqueness(role)` | Strip seniority prefixes (Sr, Lead, Staff) for grouping |
| `getPersonaBucket(role)` | Get canonical title, dedup key, and summary for a role |
| `getPersonaDisplayTitle(role)` | Clean role title for display |
| `inferRoleCategoryId(role, summary?)` | Match role to a category tab via regex |
| `formatAgo(dateIso)` | Format ISO date to "5m ago", "3h ago", "2d ago" |
| `maskPosterName(name)` | Privacy mask: "John Smith" → "Joh••• Smi•••" |
| `getPersonaDetailColumns(persona)` | Extract detail columns (experience, visa, rate, etc.) from persona fields |
| `getPersonaSkillList(role, personaSkills?)` | Parse comma-separated skills or infer from HOTLIST_AI_SUGGESTIONS |

### Leaderboard Building

| Function | Purpose |
|----------|---------|
| `buildSeedLeaderboard()` | Create initial leaderboard from 10 hardcoded HOTLIST_AI_SUGGESTIONS |
| `buildFallbackLeaderboardFromRoles(rows)` | Aggregate `hotlist_ai_roles` DB rows into personas, carrying all detail fields |
| `buildInsertPayload(accountId, targetRole, avatarUrl?)` | Create insert payload for adding a new watched role |

### Feed & Matching

| Function | Purpose |
|----------|---------|
| `dedupeText(input)` | Normalize text for dedup comparison |
| `buildSocialLeadDedupKey(row)` | Create composite key from title+company+location+poster for dedup |
| `roleMatchesPersona(row, personaRole, personaSkills)` | Check if a social job matches a persona by role/skills |
| `loadFeed(persona)` | Load and deduplicate matches for a persona |

### Credit & Actions

| Function | Purpose |
|----------|---------|
| `chargeCredits(amount, feature)` | Deduct credits via RPC, show error on insufficient balance |
| `persistLeadAction(leadId, actionType)` | Upsert action record to `pulse_lead_actions` |
| `saveVendorToTracker(lead)` | Auto-create/update vendor in Tracker from revealed lead |

---

## UI Layout & Components

### Top Navigation
- `AppNav` component with global navigation

### Category Tabs Bar
- Horizontal scrollable row of category buttons
- Each shows icon + label + vendor count badge
- Clicking filters the profiles table to that category
- "All" tab shows unfiltered view

### Search & Filters Row
- Text search input filters profiles by role name
- Time range dropdown (1h, 24h, 48h, 3d)
- Refresh button reloads leaderboard + stats

### Profiles Table (Left Panel)
Two sections separated by a divider:

**Watching Section**
- Profiles the user is actively watching
- Shows: avatar, role title, summary, detail columns, vendor/company/job stats
- Click to select and load matches
- Watch/unwatch toggle button

**Top Profiles Section**
- Other popular profiles ranked by watcher count
- Same layout as watching section
- Paginated

### Matches Feed (Right Panel)
- **Tabs**: All / Breakdown / Revealed / Queued
- **Match Cards**: Job title, company, location, platform badge, masked poster name, time ago
- **Actions per card**:
  - **Breakdown** (costs 1 credit): Shows AI score breakdown table
  - **Reveal** (costs 1 credit): Unmasks contact info (name, email, phone) with copy buttons
  - **Queue**: Saves lead to queue for later
- **Pagination**: Shows 10 at a time with "Load More" button

### Lead Detail Modal
- Full-screen overlay when a match card is clicked
- Shows complete job details, score breakdown table, contact info
- Copy buttons for email/phone
- Link to full profile

### Mobile Responsive
- Below `lg` breakpoint: toggle between Board and Feed views
- Single column layout on mobile

---

## Feature Details

### Role Watching
- Users can watch/unwatch roles via toggle button on each persona row
- Watching inserts a row into `hotlist_ai_roles` with `is_active=true`
- Unwatching sets `is_active=false`
- Watched roles appear in a separate "Watching" section at the top

### AI Match Scoring
- Scores come from `radar_match_results` table (pre-computed by background workers)
- Score breakdown shows rule-by-rule scoring (skills, location, employment type, work type)
- `buildScoreBreakdownDisplayItems()` from `radar-match-ui.ts` formats the breakdown

### Privacy & Contact Masking
- Poster names are masked by default: "John Smith" → "Joh••• Smi•••"
- Email and phone are hidden until user pays credits to reveal
- Revealed contacts auto-sync to the Tracker page as vendor records

### Vendor Auto-Sync
When a user reveals a lead:
1. Extracts poster name, email, phone, company, location
2. Checks if vendor already exists (by email or name match)
3. Creates or updates vendor record in `vendors` table
4. Vendor appears in Tracker page automatically

### Deduplication
- Social leads are deduplicated using a composite key of title + company + location + poster
- Text normalization strips punctuation, collapses whitespace
- Prevents showing duplicate job postings from different scrape runs

### Category-Based Organization
- 10 technology categories with regex-based role classification
- Category cards show aggregated stats (vendor count with Building2 icon)
- Filtering by category updates both the profiles table and stats

---

## Database Tables Used

| Table | Operations | Purpose |
|-------|-----------|---------|
| `hotlist_ai_roles` | SELECT, INSERT, UPDATE | Role watching state & settings |
| `social_jobs` | SELECT | Scraped job postings source |
| `radar_match_results` | SELECT | Pre-computed AI match scores |
| `pulse_lead_actions` | SELECT, UPSERT | Track reveal/breakdown actions |
| `vendors` | SELECT, UPSERT | Auto-sync revealed contacts |
| `accounts` | SELECT | Account context |

---

## Credit System

| Action | Cost | What Happens |
|--------|------|-------------|
| Reveal Contact | 1 credit | Unmasks name, email, phone; syncs to Tracker |
| Score Breakdown | 1 credit | Shows detailed AI scoring table |

Credits are consumed via `consume_feature_credit` RPC. On insufficient balance, a toast error is shown. The legacy fallback `consumeCreditsLegacy` is also supported.

---

## Dependencies

| Dependency | Usage |
|------------|-------|
| `react`, `react-router-dom` | Core framework, navigation |
| `lucide-react` | All icons (30+ icons used) |
| `AppNav` | Top navigation bar |
| `Toast` | Notification toasts |
| `LogoSpinner` | Loading spinner |
| `useAuth` | Authentication context (user, account, credits) |
| `supabase` | Database client |
| `HOTLIST_AI_SUGGESTIONS` | 10 seed role suggestions |
| `buildScoreBreakdownDisplayItems` | Score breakdown display formatting |
