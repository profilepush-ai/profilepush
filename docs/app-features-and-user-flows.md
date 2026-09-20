# ProfilePush — Full Feature & User Flow Guide

**Generated:** 2026-09-09
**Scope:** Every live feature in the product today, organized by the Vendor / Bench Sales persona split, plus the marketing site. Supersedes the older docs in this folder (`profilepush-platform-documentation.md` and page-specific docs dated Aug 2026), which predate the persona system entirely and describe a single-audience ("bench sales only") product.

Anywhere a feature is not actually live (dead code, hidden behind a flag, or a placeholder), it's called out explicitly as **Not Live** so this document doesn't overstate what the product does today.

---

## 1. What ProfilePush Is

ProfilePush is an AI copilot for US IT staffing — bench sales recruiters and vendor teams. It watches live job/consultant activity, drafts outreach, runs automatic AI video screening on applicants, and keeps every conversation and submission organized in one place.

The entire logged-in app is split by a single account-level setting: **persona** (`accounts.active_persona`, `'vendor' | 'bench_sales' | null`). Every major page — Feed, Posts, Tracker, Pulse (dashboard), Active List — renders different labels, icons, routes, and (for Pulse/Active List) different data depending on which persona is active. This isn't two separate apps; it's one codebase that reads `account.active_persona` and branches.

| Persona | Self-description (shown at signup) | What they do |
|---|---|---|
| **Vendor** | "I post Job requirements and request resumes off Hotlist listings." | Posts open requirements, sources consultants, reviews applicants, screens automatically via AI |
| **Bench Sales** | "I post my Hotlist of consultants and apply to Jobs on their behalf." | Posts consultants (individually or in bulk), browses jobs, submits candidates, responds to inbound resume requests |

A single account can switch persona at any time (pill switcher in the header, `AppNav.tsx`'s `PersonaSwitcher`) via the `set_active_persona` RPC — it's a global setting, not a per-session choice.

---

## 2. Onboarding & Authentication

### 2.1 Email/password signup (`src/pages/SignUp.tsx`)
Progressive, email-first form: only a **Work Email** field shows initially. The moment anything is typed into it, four more fields reveal: Full Name, Business/Agency Name, Phone (with a searchable country-code picker defaulting to a locale-detected country), and Password (min 6 chars).

On submit:
1. `supabase.auth.signUp(...)`.
2. If Supabase requires email confirmation (no session returned), the UI shows a "check your inbox" screen claiming the workspace "will be created automatically on first login."
3. If a session comes back immediately, the client creates the workspace right there: inserts into `accounts` (owner = the new user) then `account_members` (`role: 'owner'`, `status: 'active'`).
4. Fires a signup webhook and welcome email (both non-blocking), then redirects to `/feed`.

**Known gap:** the "created automatically on first login" promise only holds for the Google sign-in path (see below) — plain email/password sign-in (`SignIn.tsx`) does **not** call the account-provisioning helper. A user who confirms their email and signs in with password (never having gone through the immediate-session branch above) can end up authenticated with no workspace. Worth fixing if this path is actually being hit in production.

### 2.2 Google OAuth — web
Two implementations coexist:
- **Google Identity Services (GSI) button** (`GoogleSignInButton.tsx`, shared/reused on the sign-in prompt modal and paywall overlays) — renders Google's native button, exchanges the credential via `supabase.auth.signInWithIdToken`.
- **Popup/redirect fallback** — used if the GSI client ID isn't configured, via `supabase.auth.signInWithOAuth`.

Either way, after auth succeeds the client calls `ensureAccountForUser(user)` (see 2.4).

### 2.3 Google OAuth — native (Capacitor)
Google's SDK blocks in-app WebViews, so native apps open the **system browser** (Chrome Custom Tabs / SFSafariViewController) via `Capacitor Browser.open()`, listen for a custom-scheme deep link (`com.profilepush.app://auth-callback`) carrying the session tokens in the URL fragment, call `supabase.auth.setSession()`, then `ensureAccountForUser()`. (This call was previously missing and caused native Google sign-ups to be "authenticated but account-less" — now fixed.)

### 2.4 Account provisioning (`src/lib/account-provisioning.ts`)
There is **no database trigger** that creates an account when a new `auth.users` row appears — every entry point that can produce a new authenticated user must call `ensureAccountForUser()` itself. It checks for an existing active membership; if none, creates an `accounts` row (named from full name / email-local-part / "My Workspace") and an owning `account_members` row. Called from: Google sign-up, Google sign-in, the shared Google button, and the native deep-link handler.

### 2.5 Sign-in (`src/pages/SignIn.tsx`)
Same progressive email→password reveal as signup. Friendly error mapping (wrong password, unconfirmed email, rate-limited). Forgot-password flow via `resetPasswordForEmail`. Post-login redirect target is sanitized against open-redirect (`getSafeRedirect()` rejects `//` and `://` targets).

### 2.6 The Persona Gate (`src/components/PersonaGateScreen.tsx` + `ProtectedRoute.tsx`)
Every protected route passes through `ProtectedRoute`. If the account exists but `active_persona` is `null`, it renders a **full-screen, non-dismissable** gate instead of the requested page — no close button, no skip, no ESC path. This covers brand-new signups and any legacy account that never declared a persona. Picking Vendor or Bench Sales calls `set_active_persona`, then the app naturally renders once the field is populated.

---

## 3. Feed — Live Jobs / Hotlist (`src/pages/PulsePage.tsx`, mounted at `/feed/*`)

**Naming note:** despite the filename `PulsePage.tsx`, this is the social **feed** (Jobs/Hotlist), not the "Pulse" nav item — that's a completely different page (the analytics dashboard, §9). Don't confuse the two.

- **Vendor** browses **Hotlist** (`/feed/hotlist`) — available consultants.
- **Bench Sales** browses **Jobs** (`/feed/jobs`) — open requirements.

Each feed aggregates two sources into one list: posts made directly by other ProfilePush users (`post_source = 'user_post'`) and postings scraped from LinkedIn/Facebook/WhatsApp/Reddit groups and job boards (`post_source = 'linkedin_scrape'`). AI normalizes scraped posts (skills, visa type, rate, experience) via `radar_match_results` so both sources render with the same structured fields. A scraped job/consultant post only appears in the feed once it has been AI-processed into a `radar_match_results` row — during a scraping backlog this can lag behind raw ingestion by minutes.

**Actions available on a feed card:**
- **Preview** the full post content.
- **Ask AI** (on a scraped/non-platform lead) — AI drafts and sends a personalized outreach email (resume request on Hotlist, job-detail request on Jobs) via the vendor's connected Gmail or a shared Mailgun address. Costs **1 credit**, but only for the first generation — replaying an existing draft is free.
- **Request/Submit** (on a platform-native post) — creates a `pulse_ask_ai_requests` row the other side answers in-app (see §5).

Client-side dedup collapses near-identical scraped reposts (same normalized title+company+location+platform) into one card, and a per-account "ignored" list hides anything a user has explicitly dismissed — so the feed count you see is usually noticeably lower than the raw scraped-row count, by design, not a bug.

A Cloudflare Worker (`pulse-feed-cache`) fronts the feed RPC with a 90-second KV cache for fast repeat loads.

---

## 4. Posts — My Jobs / My Hotlist (`src/pages/MyPostsPage.tsx`, `/posts/*`)

Where each persona creates and manages their own listings.

- **Vendor** → "My Jobs" (`/posts/jobs`). **Bench Sales** → "My Hotlist" (`/posts/hotlist`).

### 4.1 Creating a post (`src/components/posts/PostFormModal.tsx`)
Paste the raw text you'd normally post to a group → "Auto-fill fields from this text" calls the `extract-post-fields` edge function to populate title, company, location, skills, experience, visa type, rate range, etc. Review/adjust, then post. **Costs 1 credit.** Editing an existing post is always free.

### 4.2 Bulk posting (Bench Sales only)
If the pasted text contains a multi-consultant table, the form auto-detects it and switches to a batch-review UI listing every parsed candidate — post them all in one click via `create_user_hotlist_posts_batch`.

### 4.3 Managing posts
List view with Open/Closed status filter, search, date-range filter. Selecting a post shows:
- **Job post (Vendor)** → inline applicant list + detail panel (see §5.1) in the same 3-column master-detail layout.
- **Hotlist post (Bench Sales)** → inline list of inbound resume requests + detail panel (see §5.2), same layout pattern.

---

## 5. Applications & Requests — the two-sided response flow

### 5.1 Vendor reviewing Job applicants (`src/pages/PostApplicationsPage.tsx`)
Search/filter by status (Applied / Screening Sent / Screening Submitted / Qualified / Rejected). Each applicant shows: resume (inline viewer), AI score badge (0–100), AI-written summary, and a "Watch" button opening the full screening video (see §8 for the full pipeline). Vendor can **Qualify** or **Reject** (`set_job_application_decision`) and start an in-app chat with the submitting recruiter.

### 5.2 Bench Sales submitting to a Job (`src/components/SubmitApplicationModal.tsx`)
Upload a resume — AI (`parse-resume`, Cloudflare Workers AI) extracts the candidate's name/email/phone automatically, no retyping. Submission is **free**; it immediately kicks off the AI screening pipeline and hands back a shareable screening link. Works identically whether the job is a platform post or a scraped lead.

### 5.3 Vendor requesting a resume off a Hotlist post
On a scraped Hotlist lead → **Ask AI** drafts an outreach email (§3). On a platform-native Hotlist post → creates a `pulse_ask_ai_requests` row that shows up for the Bench Sales owner as described next.

### 5.4 Bench Sales responding to a resume request (`src/pages/HotlistRequestsPage.tsx`, `src/components/SubmitHotlistResumeModal.tsx`)
Every inbound request against your own Hotlist post shows with status (Awaiting Resume / Resume Sent / Failed). Respond by uploading a resume + optional note (`submit_hotlist_resume` RPC) — **no credit charge**, and deliberately no AI parsing/screening step here (the candidate's details already live on the Hotlist post; this is a simple one-way file hand-off, not the full Jobs-side pipeline). The requesting Vendor sees it land in their Tracker with a download link and a notification.

This same interaction is also available **inline** in Posts (§4.3) via the same 3-column master-detail pattern used for Job applicants — clicking a request shows its detail with a Respond button, no separate page navigation needed on desktop.

---

## 6. Tracker — outbound activity log (`src/pages/TrackerPage.tsx`, `/tracker/*`)

- **Vendor** → "Requests" (`/tracker/requests`) — every outbound Hotlist resume ask, with status (Requesting… / Awaiting Resume / Resume Received / Failed / Refunded), a download link once fulfilled, and the recruiter's note.
- **Bench Sales** → "Submissions" (`/tracker/submissions`, renamed from "Applications" — the old `/tracker/applications` URL redirects here) — every outbound job application, with status, AI score badge, a link to the screening page, and a "Watch" button for the recorded video.

Both views share search, Open/Closed filtering, and a combined "all" view across both request types.

---

## 7. Inbox (`src/pages/InboxPage.tsx`, `/inbox`)

Where every AI-drafted outreach email's replies land, plus any in-app chat threads tied to your own Posts — one place instead of scattered across email. Includes an **AI chat draft** feature (`generate-chat-message` edge function) that drafts a short reply for you to review/edit before sending (never auto-sends) — **costs 1 credit** per new generation.

---

## 8. AI Video Screening — full pipeline

This is the single most complex feature in the product. Full step-by-step:

1. **Submission** → a `job_applications` row is created with a unique, unguessable `screening_token`. The frontend calls the `process-job-application` edge function.
2. **First question generation** — builds a compact resume summary (name, target role, years experience, core skills, a few experience bullets) plus the job's title/description, and asks an AI Worker to generate the opening question. Application status → `screening_sent`. The candidate is emailed a link: `https://profilepush.ai/screen/{screening_token}` (best-effort, doesn't block).
3. **Candidate experience** (`src/pages/ScreeningInterview.tsx`, no ProfilePush account required — the token itself is the access control):
   - **Consent screen** shown before any camera/mic access — explicitly states the interview is recorded, AI asks adaptive follow-ups, and the recruiter will see the full video + AI summary + resume together. Declining dead-ends the flow.
   - **One continuous recording** for the whole interview (not per-question clips) — a single `MediaRecorder` is started once and paused/resumed at question boundaries, stopped exactly once at the end, so the video timeline stays consistent for later seeking.
   - Per question: max 90 seconds to answer, at most **1 retake**, then Submit & Next.
   - Each answer's audio is transcribed live (Whisper via Cloudflare Workers AI) — the audio clip itself isn't stored, only its transcript; a transcription failure just degrades to an empty transcript rather than failing the turn.
   - **Adaptive follow-up**: the next question is generated from the full history of prior answers plus the job/resume context, built to probe for specifics ("a real example, a number, a tool, a decision they made"). **Hard cap: 3 questions total** — the model cannot extend the interview past this regardless of what it returns.
   - Once done (never before 2 questions answered), an AI score (0–100) and a 3–5 sentence written summary (explicitly instructed to call out both strengths and red flags) are generated and saved immediately — even before the full video finishes uploading.
   - **Finalize**: the complete video uploads to Cloudflare R2. This step is a hard failure if it doesn't succeed (unlike everything else in this pipeline, which is best-effort) — the candidate's browser keeps the blob in memory to retry. On success: status → `screening_completed`, an in-app chat notification goes to the job-posting Vendor, and the credit charge fires (next point).
   - If a candidate closes the tab after answering but before finalize completes, reopening the link shows a dead-end "Recording Didn't Finish" screen — no resume path; they need a fresh link.
4. **Vendor review** (`PostApplicationsPage.tsx` → `ScreeningSubmissionModal.tsx`): streams the video, lets the Vendor step Previous/Next between questions (seeking to each answer's stored timestamp), shows the AI score + summary alongside the resume, and offers Qualify/Reject.
5. **Credit charge**: exactly **50 credits**, charged to the **job-owning (Vendor) account** — not the submitting recruiter — via a service-role-only RPC (the Cloudflare Worker has no user session to call the normal credit-consumption path). Fires once, right after the video lands in R2. **Best-effort**: a failed or insufficient-credit charge is only logged, never blocks or fails the candidate's submission.

---

## 9. Pulse — Analytics Dashboard (`src/pages/DashboardPage.tsx`, `/pulse`)

**Naming note again**: this is the nav item labeled "Pulse" — a persona-gated analytics dashboard, unrelated to the `PulsePage.tsx` file (which is the Feed, §3). One page, branches entirely on `active_persona`.

Time range picker: Last 7 / 30 / 90 days.

**Vendor sees:**
- Activity heatmap (previews, applications, Hotlist requests sent)
- Stat tiles: Conversations, Bench Sales Contacts unlocked (via Active List)
- Funnel: My Jobs — Posted → Previewed → Applied → Screening Done → Qualified (rejections reported separately, not chained into the conversion %)
- Funnel: Hotlist — Requested by me → Fulfilled
- Daily trend chart: previews / applications / hotlist requests

**Bench Sales sees:**
- Activity heatmap (Hotlist previews, requests received, jobs applied to)
- Stat tiles: Conversations, Vendor Contacts unlocked
- Funnel: My Hotlist — Posted → Previewed → Requested → Fulfilled
- Funnel: Jobs — Reached Out → Progressed → Qualified
- Daily trend chart: hotlist previews / requests received / jobs applied

**Not Live:** an "AI Insights" panel exists in the code but is hardcoded off pending Gemini billing being restored. A separate "bench-match / predict-match / daily match summary" system (profile-watching across external job boards with an AI match-summary email) exists in the codebase but is not wired into this dashboard or the nav — it's disconnected legacy code. There is no "tech-stack demand/rate ranking" widget despite older marketing copy referencing one — that concept was fully replaced by the funnel/heatmap/trend dashboard described above.

---

## 10. Active List (`src/pages/ActiveListPage.tsx`, `/active-list`)

A live, filterable directory of contacts, persona-gated:
- **Vendor** sees recruiter/Bench Sales contacts (to source consultants from).
- **Bench Sales** sees vendor contacts (companies to pitch to).

Filters: role-title search, experience bucket, work type, employment type, visa status, location, skills, and rate range — all with live per-option counts. Time range: 24h / 3d (default) / 7d / 15d / 30d. PII is masked by default in the table (first 3 characters visible).

**Download**: select rows, click Download — gated server-side by `check_and_log_active_list_download`. **Current limit: every account, free or paid, is capped at 50 contact downloads per rolling 24-hour window** (checked against a real 24h window, not a UTC-midnight reset, specifically to prevent a "wait for reset" bypass). This replaced an older free-vs-Pro model (50/download + 500 lifetime for free, unlimited for Pro) — if you've seen that older number elsewhere, it's superseded.

---

## 11. Contacts (`src/pages/ContactsPage.tsx`, `/contacts`)

A lightweight mini-CRM layered on top of Tracker data, not a general address book:
- **Vendors** shown here are filtered to only those matching a lead you've actually interacted with via Tracker (by email, phone, contact name, or company/poster name) — not an arbitrary list.
- **Clients** are a straightforward manually-managed CRM entity.
- **Submissions** is a manual log (candidate, skill set, vendor/client, rate, etc.) with duplicate-submission detection before saving.

Per-vendor drill-down shows their full job/Hotlist posting history. CSV export, date-range filtering, and bulk actions throughout.

---

## 12. Credits & Billing

### 12.1 The master switch
`BILLING_GATES_ENABLED = false` — the legacy paywall (charging for reveals, match-score breakdowns, post-content views) is currently **off site-wide**, "so the platform runs free for now." Nothing was deleted; it can be re-enabled by flipping one flag. Meanwhile, credit UI (`shouldShowCreditsUi()`) is hardcoded **on** regardless of that flag, and a newer, separate set of explicit charges (below) are fully live and enforced independent of the legacy switch.

### 12.2 The free grant
Every new account gets **500 credits, once, that never expire** — stamped directly onto the `accounts` row at creation.

### 12.3 What actually costs credits today

| Action | Cost |
|---|---|
| Create a new Job or Hotlist post | 1 credit (editing is free) |
| Generate a new AI outreach draft (Ask AI / AI Submit / AI Request) | 1 credit (only on first generation; replays are free) |
| Generate a new AI in-app chat draft (Inbox) | 1 credit |
| A candidate completing an AI video screening | 50 credits, charged to the **Vendor** (job-owning) account, best-effort |
| Active List email download | Governed by the 50/24h rolling cap (§10), not a per-email credit charge |

Post creation and screening charges are enforced atomically server-side (row-locked balance check + deduction in one transaction); AI draft generation charges up front and **refunds** automatically if the downstream generation call fails.

### 12.4 Plans
- **Free**: ₹0/mo, 500 one-time credits, full feature access, unlimited team members, subject to the Active List rolling cap.
- **Pro**: subscription via Razorpay, tiered credit amounts delivered automatically each cycle, cancel-anytime (access continues until period end). Only the account **owner** can subscribe, change tier, or cancel.
- **One-time top-ups**: 500–5,000 credit packs at a flat ₹1/credit, also via Razorpay, no expiry.

Running out triggers an `InsufficientCreditsModal` ("You need 1 credit to {action}, you have {N} left") with a CTA to `/billing` — shown from post creation, AI chat drafts, and the (currently unreachable) legacy predict-match path.

---

## 13. Notifications

Three channels, all triggered from a single `notifications` table insert:

1. **In-app bell** (`AppNav.tsx`) — loads the 15 most recent notifications, live-updates via a Supabase Realtime subscription on new inserts, shows an unread-count badge (caps display at "9+").
2. **Push** (OneSignal → FCM/APNs) — every single notification insert triggers a push via a Postgres trigger → edge function → Cloudflare Queue → `push-notification-worker` → OneSignal. Not just some notification types; all of them.
3. **Daily email digest** — a Cloudflare Worker cron job (7:00 PM IST) sends one personalized "N New Jobs & M New Hotlist Consultants" email per user via GMass, covering the last 24 hours. **Sender warm-up ramp**: because it rides a real Gmail/Workspace mailbox's sending reputation, only a rotating subset of recipients get the email for the first 30 days after launch (Day 1 = 10 people, ×1.2/day after that, uncapped from day 30). **The in-app bell and push notification for the same digest are never capped by this warm-up** — only the email leg is throttled.

Each user can independently toggle in-app/email/WhatsApp per notification type via `notification_preferences` (14 types across Pipeline, AI, Usage, Team, Billing, and Reports categories).

---

## 14. Account Settings & Team Management (`src/pages/AccountSettings.tsx`, `/account`)

Four sections: Billing, Profile, Workspace, Integrations.

- **Profile**: avatar, name, email, role/data-access badges, Logout, Leave Workspace (non-owners). "Delete Workspace" — **Not Live**: the confirm flow exists in the UI but the actual button just shows "please contact support," there's no self-service deletion implemented.
- **Workspace**: rename (owner-only — this is the one column client writes are still allowed on `accounts`, everything else including `credits_balance` was locked down after a security fix). Team member list with inline role/data-access editing and removal. Pending invites show a "copy invite link" that's really just plain-text sign-up instructions — there's no signed invite token; joining is simply signing up with the matching email.
- **Roles**: `owner` (one per account, only one who can rename/bill/invite/manage members), `admin` (always full data access), `member` (data access can be `full` or `assigned_only`). Note: `assigned_only` enforcement at the data layer wasn't independently re-verified in this pass — the settings page sets the flag, but confirm the actual RLS/query-level filtering elsewhere before treating it as fully enforced everywhere.
- **Integrations**: connect/disconnect a real Gmail address (OAuth) so outbound emails send from the user's own address instead of a shared inbox.

---

## 15. Alerts Page (`/alerts`) — Not Live

A "Coming Soon" waitlist screen for a planned "live job alerts for your watchlist" paid feature. Clicking "Join Waitlist" just records interest (`feature_requests` table); there is no alert-delivery mechanism behind it today. Don't confuse this with the daily digest email (§13), which is fully live but account-wide rather than watchlist-scoped.

---

## 16. Marketing Site

- **`/`** — general landing page: hero (H1 + trust row, no video), a 2-column Vendor/Bench Sales comparison widget directly in the hero (above the fold on both desktop and mobile), pricing, FAQ, final CTA.
- **`/vendors`** and **`/bench-sales`** — dedicated persona landing pages sharing one `PersonaLandingTemplate` component, each with its own hero, feature walkthrough (reusing the same uploaded product screenshots/videos), FAQ, and CTA.
- All three (plus `/it-staffing-vendor-list`, `/it-staffing-bench-sales-recruiters-list`, `/how-it-works`, `/why-ai-copilot`, `/vs/:competitor`) share one `MarketingNav` component: logo, a Vendor/Bench Sales switcher pill, a consolidated "Lists" dropdown, Sign In, Start Free.
- `/it-staffing-vendor-list` and `/it-staffing-bench-sales-recruiters-list` are SEO/lead-gen pages built around a live, gated preview table of real recent activity (not a static purchased list) plus long-form educational content (glossary, chain-of-roles diagrams, FAQ).

---

## 17. Known Gaps & Dead Code (for future cleanup)

- `SignIn.tsx`'s plain email/password path never calls `ensureAccountForUser()` — only its Google path does. Worth confirming whether this leaves any real users account-less.
- Dashboard's "AI Insights" panel is hardcoded hidden pending Gemini billing.
- A parallel "bench-match / predict-match / daily match summary" system exists but is disconnected from the current nav and dashboard.
- "Delete Workspace" in Account Settings is UI-only; it doesn't actually delete anything.
- Global Watch Schedule state exists in `AccountSettings.tsx` but wasn't confirmed to be rendered anywhere in the visible JSX — may be orphaned.
- The Active List download cap has changed twice (free/paid split → flat rolling 24h cap for everyone); make sure any external-facing copy reflects the current flat cap, not the older model.
- Alerts page is a waitlist, not a real feature.
