# Inbox Page — Technical Documentation

> **File**: `src/pages/InboxPage.tsx` (658 lines)
> **Routes**: `/inbox`, `/inbox/:conversationId`
> **Purpose**: A two-panel email-style inbox for vendor/bench-sales-recruiter conversations. Threads are created automatically when a user sends an "Ask AI" request from the Jobs or Hotlist pages (or when a vendor message arrives). The page supports conversation search, date-range filtering, status tabs, per-message delivery tracking (queued → delivered → opened), credit-gated email reveal, and realtime updates.

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

The Inbox page is the messaging hub for bench sales recruiters. It displays conversations created when:

- The user sends an **Ask AI vendor email** from the Jobs page (creates a `vendor_conversation` linked to a `social_jobs` job).
- The user sends an **Ask AI resume-request email** from the Hotlist page (creates a `vendor_conversation` linked to a `social_hotlist` entry).
- A vendor replies and the email is ingested into the system by the `vendor-mail-worker`.

The page features:
- A **conversation list** (left panel) with search, date-range filter, and All/Asked/Replied status tabs.
- A **thread view** (right panel) showing the full message history with delivery status.
- **Realtime subscriptions** via Supabase Realtime (channels on `vendor_conversations`, `vendor_messages`, `vendor_message_events`).
- **Privacy masking** — vendor names and emails are masked until the user pays credits to reveal.
- **Credit-gated email reveal** — costs $0.25 credits to un-mask the vendor email.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          AppNav (top bar)                        │
├──────────────────────────────────────┬───────────────────────────┤
│  Search + Range + Tabs               │                           │
│  ┌────────────────────────────────┐  │   Thread View (right)     │
│  │ [Search...] [7d]               │  │                           │
│  │ [All 12] [Asked 5] [Replied 3] │  │   Header:                │
│  ├────────────────────────────────┤  │   Job/Hotlist badge  •  Status│
│  │ Conversation List              │  │   ┌───────────────────┐  │
│  │ ┌────────────────────────────┐ │  │   │ Job Reference Card │  │
│  │ │ Job title           2h     │ │  │   │ (job/hotlist info) │  │
│  │ │ Exp: 5y • Rate: $60 • ...  │ │  │   └───────────────────┘  │
│  │ │ [Job]  [3]                 │ │  │   ┌─ Message ──────────┐ │
│  │ ├────────────────────────────┤ │  │   │ Outbound (blue)    │ │
│  │ │ Hotlist title       5h     │ │  │   │ [Delivered ✓✓]     │ │
│  │ │ Exp: 3y • Rate: $45 • ...  │ │  │   └────────────────────┘ │
│  │ │ [Hotlist]  [1]             │ │  │   ┌─ Message ──────────┐ │
│  │ └────────────────────────────┘ │  │   │ Inbound (gray)     │ │
│  │   ... more conversations       │  │   │ [Received]         │ │
│  │                                │  │   └────────────────────┘ │
│  └────────────────────────────────┘  │   [Copy Email / Reveal]  │
└──────────────────────────────────────┴───────────────────────────┘
```

---

## Data Model

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `vendor_conversations` | Conversation threads (vendor, job/hotlist link, status, unread count) |
| `vendor_messages` | Individual messages within a conversation |
| `vendor_message_events` | Delivery events (e.g., `opened`, `delivered`) |
| `social_jobs` | Job postings (joined via `job_id`) |
| `social_hotlist` | Hotlist postings (joined via `hotlist_id`) |
| `radar_match_results` | Job match score breakdowns (joined via `job_id`) |
| `radar_match_hotlist` | Hotlist match score breakdowns (joined via `hotlist_id`) |
| `pulse_lead_actions` | Tracks whether the user revealed contact (`action_type='revealed'`) |
| `accounts` | Account context, credits balance |
| `credit_transactions` | Usage log entries |

### Supabase RPCs

| RPC | Purpose |
|-----|---------|
| `update_own_vendor_conversation` | Mark a conversation as read (`p_action='read'`) |
| `consume_feature_credit` | Deduct credits for email reveal |
| `get_pulse_social_feed` | (Used elsewhere; not in this page) |

---

## Types & Interfaces

### `Conversation`
A conversation thread.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID primary key |
| `vendor_name` | `string` | Vendor company name |
| `vendor_email` | `string` | Vendor email |
| `sender_name` | `string` | Sender display name |
| `subject` | `string` | Conversation subject |
| `status` | `ConversationStatus` | `'pending' \| 'open' \| 'replied' \| 'closed' \| 'failed'` |
| `unread_count` | `number` | Unread message count |
| `last_message_at` | `string` | ISO timestamp of last message |
| `created_at` | `string` | ISO creation timestamp |
| `job_id` | `string \| null` | Linked social job ID |
| `hotlist_id` | `string \| null` | Linked social hotlist ID |
| `social_jobs` | `SocialJobDetails \| null` | Joined job posting data |
| `social_hotlist` | `SocialHotlistDetails \| null` | Joined hotlist data |
| `radar_job_details` | `Record<string, RadarBreakdownEntry \| number> \| null` | AI score breakdown |

### `Message`
A single message in a thread.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID |
| `direction` | `'outbound' \| 'inbound'` | Direction |
| `sender_type` | `'user' \| 'vendor' \| 'system'` | Sender |
| `from_email` / `to_email` | `string` | Email addresses |
| `subject` | `string` | Subject |
| `text_body` | `string` | Raw text body |
| `display_text` | `string \| null` | Privacy-processed display text |
| `display_text_status` | `'pending' \| 'complete' \| 'failed' \| null` | Display text state |
| `status` | `'queued' \| 'accepted' \| 'delivered' \| 'temporary_failed' \| 'failed' \| 'received'` | Delivery status |
| `error_message` | `string \| null` | Error detail |
| `sent_at` / `received_at` / `created_at` | `string \| null` | Timestamps |
| `vendor_message_events` | `Array<{ event_type, occurred_at }>` | Delivery events |

### Other Types
- **`ConversationStatus`** — `'pending' | 'open' | 'replied' | 'closed' | 'failed'`
- **`InboxRangeId`** — `'24h' | '3d' | '7d' | '15d' | '30d'`
- **`DisplayJobDetail`** — `{ key, label, value }`
- **`RadarBreakdownEntry`** — `{ job_value?, rule? }`
- **`SocialJobDetails`** / **`SocialHotlistDetails`** — Joined source data
- **`InboxFilter`** — `'all' | 'asked' | 'replied'`

---

## Constants

### `INBOX_RANGE_OPTIONS`
Date-range filter options:

| ID | Label | Hours |
|----|-------|-------|
| `24h` | Last 24 hours | 24 |
| `3d` | Last 3 days | 72 |
| `7d` | Last 7 days | 168 |
| `15d` | Last 15 days | 360 |
| `30d` | Last 30 days | 720 |

### `STATUS_LABELS`
Maps `ConversationStatus` to display labels (pending/open/replied/closed/failed).

### `JOB_DETAIL_FIELDS`
Ordered list of detail fields rendered in the job reference card:
- `experience_match` → Exp
- `work_type_match` → Work Type
- `employment_type_match` → Emp Type
- `hourly_rate_match` / `rate_match` → Rate
- `visa_match` → Visa
- `location_match` → Location
- `skills_match` → Skills

### Reveal Cost
`0.25` credits for revealing a vendor email.

---

## State Management

### Data State

| Variable | Type | Purpose |
|----------|------|---------|
| `conversations` | `Conversation[]` | All loaded conversations |
| `messages` | `Message[]` | Messages in the active thread |
| `selectedId` | `string \| null` | Selected conversation ID |
| `messagesConversationId` | `string \| null` | Conversation ID whose messages are loaded |
| `loading` | `boolean` | Initial conversation list loading |
| `loadingMessages` | `boolean` | Thread loading state |
| `revealedJobIds` | `Set<string>` | Lead IDs where email was revealed |
| `revealingJobId` | `string \| null` | Lead ID currently being revealed |

### Filter State

| Variable | Type | Purpose |
|----------|------|---------|
| `query` | `string` | Applied search query |
| `pendingQuery` | `string` | Search input buffer |
| `filter` | `'all' \| 'asked' \| 'replied'` | Status tab |
| `rangeId` | `InboxRangeId` | Date range (default `7d`) |
| `isRangeMenuOpen` | `boolean` | Range menu open state |

### Derived State

| Variable | Type | Purpose |
|----------|------|---------|
| `selected` | `Conversation \| null` | Conversation for `selectedId` |
| `scopedConversations` | `Conversation[]` | Search + date-range filtered |
| `tabCounts` | `{ all, asked, replied }` | Tab badge counts |
| `filtered` | `Conversation[]` | Final filtered list (status tabs applied) |

---

## Data Flow & Lifecycle

### 1. Initial Load (`useEffect` on mount)

```
loadConversations()
  ├── SELECT vendor_conversations
  │     └── Join social_jobs + social_hotlist
  ├── Collect job_ids + hotlist_ids
  ├── SELECT radar_match_results (job_source='social') for job_ids
  ├── SELECT radar_match_hotlist for hotlist_ids
  ├── Merge score_breakdown → radar_job_details per lead
  ├── SELECT pulse_lead_actions (action_type='revealed')
  │     └── Set revealedJobIds
  └── Set conversations + auto-select first (desktop ≥ 640px)
```

### 2. Thread Loading

```
useEffect(selectedId)
  ├── loadMessages(selectedId)
  │     └── SELECT vendor_messages ORDER BY created_at ASC
  │           └── Join vendor_message_events
  ├── supabase.rpc('update_own_vendor_conversation', { p_action: 'read' })
  │     └── Local unread_count → 0
  └── Auto-scroll to bottom (requestAnimationFrame)
```

### 3. Realtime Subscriptions

```
supabase.channel('vendor-inbox')
  ├── ON postgres_changes: vendor_conversations (*) → loadConversations()
  ├── ON postgres_changes: vendor_messages (*)   → if conversation_id === selectedId → loadMessages()
  └── ON postgres_changes: vendor_message_events (INSERT) → if selectedId → loadMessages()
```

### 4. Email Reveal Flow

```
revealEmail(conversation)
  ├── leadId = job_id ?? hotlist_id ?? conversation.id
  ├── consume_feature_credit RPC (0.25, 'pulse_reveal_contact')
  │     ├── On error → legacy direct balance update
  │     │     ├── SELECT accounts.credits_balance
  │     │     ├── UPDATE accounts credits_balance -= 0.25
  │     │     └── INSERT credit_transactions (usage, -0.25)
  │     └── On success → consume (via RPC row.success)
  ├── Upsert pulse_lead_actions (action_type='revealed')
  ├── setRevealedJobIds + refreshAccount()
  └── Toast "$0.25 credits consumed for reveal"
```

### 5. Filtering Pipeline

```
scopedConversations = conversations.filter(c =>
  c.last_message_at >= cutoff (rangeId) &&
  (no query OR vendor_name/vendor_email/subject/job_title/role_title includes query)
)

tabCounts =
  all: scopedConversations.length
  asked: (status === 'pending' || status === 'open')
  replied: status === 'replied'

filtered = scopedConversations.filter(c =>
  filter === 'asked'  → pending/open
  filter === 'replied' → replied
  filter === 'all'    → all
)
```

---

## Core Functions

### Loading

| Function | Purpose |
|----------|---------|
| `loadConversations()` | Fetch all conversations + enrich with score breakdowns + reveal state |
| `loadMessages(id)` | Fetch full message thread for a conversation |

### Interaction

| Function | Purpose |
|----------|---------|
| `selectConversation(id)` | Navigate to `/inbox/:id` |
| `revealEmail(conversation)` | Credit-gated email reveal (with legacy fallback) |
| `messageDeliveryState(message)` | Compute delivery status label (Opened/Delivered) from events |
| `getJobDisplayDetails(breakdown, includeMissing?)` | Build job detail rows from score breakdown |
| `getJobSummary(breakdown)` | Single-line summary for list rows |

### Privacy Helpers

| Function | Purpose |
|----------|---------|
| `maskName(name)` | `"John Smith"` → `"Joh***"` |
| `maskNameInText(text, name)` | Replace all name occurrences in text with masked form |
| `restoreSenderName(text, name)` | Restore masked name back to full name |
| `maskedEmailHint(value)` | `"abc@domain.com"` → `"abc**@***.com"` |

### Display Helpers

| Function | Purpose |
|----------|---------|
| `formatRelative(value)` | "Now", "5m", "3h", "2d" or short date |
| `formatMessageTime(value)` | "Aug 12, 3:45 PM" |
| `leadIdOf(conversation)` | `job_id ?? hotlist_id ?? id` |

---

## UI Layout & Components

### AppNav
Top navigation bar with global nav.

### Left Panel — Conversation List
- **Search bar**: filter by vendor name, vendor email, subject, job title, or hotlist role title (Enter to apply).
- **Range menu**: 24h / 3d / 7d / 15d / 30d dropdown.
- **Status tabs**: All / Asked / Replied with count badges.
- **Conversation rows**:
  - Title (job title or hotlist role title, bold if unread)
  - Summary line from `getJobSummary()` (e.g., `Exp: 5y · Rate: $60 · Visa: H1B`)
  - Relative time + unread count badge
  - Type badge: `Job` (gray) or `Hotlist` (purple)
- **Empty state**: "No conversations found — Ask a vendor from Jobs to start a thread."

### Right Panel — Thread View
- **Header**: Status badge (`Pending`/`Open`/`Replied`/`Closed`/`Failed`), type badge (`Job`/`Hotlist`).
- **Job Reference Card**: Title, posted date, poster name (masked unless revealed), company (masked unless revealed), platform, and a 3-column detail grid (Exp, Work Type, Emp Type, Rate, Visa, Location, Skills).
- **Message bubbles**:
  - **Outbound** (blue, right-aligned): sender's text with privacy masking of vendor name until revealed.
  - **Inbound** (gray, left-aligned): shows `display_text` when `display_text_status='complete'`, otherwise a placeholder.
  - Delivery footer: `Sent` / `Delivered ✓✓` / `Opened ✓✓ (emerald)` / `Failed` + timestamp.
  - Copy Email / Reveal Email button.
- **Mobile**: back arrow to conversation list.

### Toast
Success/error notifications.

---

## Feature Details

### Job Reference Card
Each thread shows a reference card (matching the Pulse page match-card style) with:
- Job title or hotlist role title
- Posted relative time + platform
- Poster name / company masked unless email revealed
- AI score breakdown details (Exp, Work Type, Emp Type, Rate, Visa, Location, Skills)

### Privacy Masking in Messages
When an email is **not** revealed:
- Vendor name appears as `Joh***` everywhere (including inside message text via `maskNameInText`).
- Vendor email shows a masked hint (`abc**@***.com`).
- Company names are truncated to 3 chars (`Acme Corp` → `Acm***`).

When revealed, `restoreSenderName` converts masked occurrences back to the full name in displayed messages.

### Delivery Tracking
Outbound messages show a delivery state computed from `vendor_message_events`:
1. `opened` event → "Opened" (emerald, double check)
2. `delivered` event (or `status === 'delivered'`) → "Delivered" (blue, double check)
3. Otherwise → "Sent" (plain)

Failed messages (`failed` / `temporary_failed`) show a red error icon + `error_message`.

### Realtime Updates
Supabase Realtime keeps the inbox live:
- Any change to `vendor_conversations` reloads the list.
- New/updated `vendor_messages` in the active thread reloads that thread.
- New `vendor_message_events` reloads the thread (for delivery/opened updates).

### Email Reveal
- Costs **$0.25** credits (`consume_feature_credit` with legacy fallback).
- Records a `pulse_lead_actions` row with `action_type='revealed'`.
- Un-masks vendor name/email/company across the thread.
- Enables the "Copy Email" button.

### `leadIdOf` Logic
The lead ID used for reveal/action tracking is:
```
conversation.job_id ?? conversation.hotlist_id ?? conversation.id
```
This aligns with `pulse_lead_actions.lead_id` written by the Jobs/Hotlist pages.

---

## Credit System

| Action | Cost | What Happens |
|--------|------|-------------|
| Reveal Vendor Email | **$0.25** | Un-masks vendor email/name/company in the thread; enables copy |

---

## Database Tables & RPCs Used

| Object | Operations | Purpose |
|--------|-----------|---------|
| `vendor_conversations` | SELECT, UPDATE (via RPC) | Conversation threads |
| `vendor_messages` | SELECT | Message history |
| `vendor_message_events` | SELECT | Delivery/open events |
| `social_jobs` | SELECT | Job details for reference card |
| `social_hotlist` | SELECT | Hotlist details for reference card |
| `radar_match_results` | SELECT | Job score breakdowns |
| `radar_match_hotlist` | SELECT | Hotlist score breakdowns |
| `pulse_lead_actions` | SELECT, UPSERT | Reveal state tracking |
| `accounts` | SELECT, UPDATE | Credits balance |
| `credit_transactions` | INSERT | Usage log |
| `update_own_vendor_conversation` | RPC | Mark-as-read |
| `consume_feature_credit` | RPC | Credit deduction |

### Row-Level Security
All tables use RLS scoped to the user's account via `account_members`, so users only see conversations and messages belonging to their account. `update_own_vendor_conversation` is a SECURITY DEFINER RPC that marks only the caller's conversation as read.

---

## Dependencies

| Dependency | Usage |
|------------|-------|
| `react`, `react-router-dom` | Core framework, `useParams`/`useNavigate` for `/inbox/:id` |
| `lucide-react` | Icons (AlertCircle, ArrowLeft, Check, CheckCheck, Clock3, Inbox, Copy, Loader2, Mail, Search, X) |
| `AppNav` | Top navigation bar |
| `Toast` | Notification toasts |
| `useAuth` | Authentication context (user, account, credits) |
| `useTheme` | Dark mode styling |
| `supabase` | Database client, RPCs, Realtime channels |
| `vendor-mail-worker` | (Backend) Ingests vendor replies into `vendor_messages` |