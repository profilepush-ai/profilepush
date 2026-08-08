# ProfilePush Platform Documentation

Generated: 2026-07-27

## 1) Product And System Overview

ProfilePush is a single-page web application for bench sales recruiters. It combines candidate profile management, multi-board job search, AI-assisted matching, resume rewriting, submission tracking, team collaboration, and usage-based billing.

High-level architecture:
- Frontend: React + TypeScript + Vite
- Styling: Tailwind CSS + custom utility styles
- Auth and Data: Supabase Auth, Postgres, Storage
- Backend Compute: Supabase Edge Functions (Deno)
- Payments: Razorpay integration through edge functions
- AI and parsing: Gemini through edge functions
- Job ingestion: board-specific fetch/search functions and webhook processors
- Hosting: Cloudflare Pages (SPA)

Primary code entry points:
- Frontend app shell and routes: src/App.tsx
- Supabase client setup: src/lib/supabase.ts
- Auth/session/account context: src/contexts/AuthContext.tsx
- Edge functions root: supabase/functions
- Migrations root: supabase/migrations

## 2) Design And Branding System

### 2.1 Visual Identity

Brand identity is implemented with a custom logo and a high-contrast blue/orange/yellow palette.

- Logo component: src/components/Logo.tsx
- Loading spinner variant: src/components/LogoSpinner.tsx
- Typical primary accents:
  - Blue: #2563eb
  - Orange: #f97316
  - Yellow: #facc15
- Utility grays are used for hierarchy and card surfaces.

Typography and iconography:
- Uses Tailwind defaults (no custom font family extension in tailwind config)
- Icon set: lucide-react

### 2.2 Layout And Style Rules

Tailwind configuration is minimal and default-oriented:
- File: tailwind.config.js
- Includes typography plugin
- No custom theme extension declared

Global CSS customizations:
- File: src/index.css
- slide-up animation utility for toast entry
- job-desc utility class for rich HTML job descriptions

### 2.3 UI Motion And Feedback

- Toast animation: .animate-slide-up
- Loading states commonly use LogoSpinner
- Page chunks are lazy-loaded with Suspense loader in App.tsx

## 3) Element-Level Layout And Reusable Components

### 3.1 Core Shared Components

- AppNav: src/components/AppNav.tsx
  - Sticky app navigation
  - Product area links
  - Notification bell integration
  - Credits visibility
  - User menu
- SiteFooter: src/components/SiteFooter.tsx
  - Public site footer and legal/navigation links
- ProtectedRoute: src/components/ProtectedRoute.tsx
  - Route-level auth guard
  - Redirects unauthenticated users to sign-in
- SEO: src/components/SEO.tsx
  - Page title, canonical, OG/Twitter metadata, JSON-LD support
- Toast: src/components/Toast.tsx
  - Success/error transient alerts
- Logo and LogoSpinner
  - Brand mark and loading state

### 3.2 Auth And Session Composition

Auth context provider:
- File: src/contexts/AuthContext.tsx
- Exposes:
  - user
  - session
  - account
  - membership
  - subscription
  - loading
  - refreshAccount
  - signOut

Behavior:
- Subscribes to auth state changes
- Loads account_membership, account, and subscription records for active users

### 3.3 App Shell Composition

- BrowserRouter wraps app
- AuthProvider wraps route tree
- ScrollToTop is route-aware
- Persistent mounted pages keep state across route changes:
  - JobFinder
  - Submission Queue
  - Resume AI

## 4) Page-Level Functionalities

Routing source: src/App.tsx

### 4.1 Public Pages

- /: LandingPage
  - Positioning, feature blocks, onboarding CTAs
  - Uses Supabase-backed feature media records and storage URLs
- /signup: SignUp
  - User registration
- /signin: SignIn
  - Authentication
- /onboard/:token: CandidateOnboarding
  - Token-driven onboarding flow
- /confirm-applied/:token: ConfirmApplied
  - Token-driven apply confirmation flow
- /privacy: PrivacyPolicy
- /terms: TermsAndConditions
- /security: SecurityPage
- /about: AboutUs
- /contact: ContactUs
- /pricing: PricingPage
- /cancellation-refund: CancellationRefundPolicy
- /vs/:competitor: ComparisonPage
- /book-demo: BookDemo
- /why-ai-copilot: WhyAICopilot
- /how-it-works: HowItWorks
- /admin: AdminDashboard

### 4.2 Protected Pages

- /desk: Desk
  - Dashboard analytics and operational metrics
- /bench: ProfilesDirectory
  - Candidate bench management and filtering
- /profile-details/:id: ProfileDetails
  - Candidate detail, files, history, and edits
- /job-finder: JobFinder
  - Job discovery workflows
- /submission-queue: WishlistPage
  - Submission queue management
- /resume-ai: ResumeAIPage
  - AI rewrite and resume optimization workflows
- /account: AccountSettings
  - Team and account settings
- /support: SupportPage
  - User support entry points
- /roadmap: RoadmapPage
  - Product roadmap interactions
- /billing: BillingPage
  - Subscription and credit views
- /pulse: PulsePage
  - Two-column layout: leaderboard of talent profiles (left) and real-time social job feed with AI match scores (right)
  - Category filter pills (Frontend, Backend, Data, Security, CRM, QA, Biz Dev, AI, ML, DevOps) and tech stack sub-filters
  - Feed tabs: All, Breakdown (paid), Revealed, Queued
  - Reveal functionality to expose poster contact info (name, email, phone)
  - Time range selector (1h, 24h, 48h, 3 days)
  - Data sources: leaderboard RPC, radar_social_matches, social_jobs
- /tracker: TrackerPage
  - Two-column layout: vendor/client contacts (left) and job history + submissions (right)
  - CRUD for vendor and client contacts (name, contact person, email, phone, location)
  - Submissions tracker with type badges (Client, Vendor, Candidate, C2C, W2, Direct)
  - Date range filters (Today, Last 7/30 days, This month, Custom)
  - Search/combobox filtering and CSV export
  - Data sources: vendors, clients, social_jobs, submissions, profiles
- /alerts: AlertsPage
  - Coming Soon page for scheduled live job match alerts (paid feature)
  - Join Waitlist button saves to feature_requests table
  - Planned delivery window: 5 PM IST to 1 AM IST daily
- /hotlist-ai: AIBenchMatch
  - AI bench matching
- /job-match-ai: RadarPage
  - Match radar and candidate-job intelligence

## 5) Supabase Architecture

### 5.1 Client Setup

File: src/lib/supabase.ts

- Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
- Adds fetch retry for HTTP 503
- Exponential backoff delays: 1000ms, 2000ms, 4000ms

### 5.2 Database Model (Code-Level Evidence)

Type definitions file: src/types/database.ts

Primary typed tables:
- profiles
- resume_files
- wishlisted_jobs
- activity_logs

Additional business entities are referenced broadly in pages, contexts, functions, and migrations, including:
- accounts, account_members, subscriptions
- notifications, notification_preferences
- job-board specific tables and search logs
- support and roadmap tables
- AI matching and usage logs

Schema source of truth:
- supabase/migrations directory
- Multiple migration files define table creation/evolution and policies

### 5.3 Storage

- Resume and media handling are integrated through Supabase Storage
- Landing media paths are read from landing_screenshots table and public object URLs
- Landing upload workflow uses bucket named landing-assets in page logic

## 6) Edge Functions Catalog

Functions directory: supabase/functions

### 6.1 AI And Candidate Intelligence

- bench-match
- generate-embedding
- generate-search-ideas
- parse-resume
- radar-enrich
- radar-match
- rewrite-field
- rewrite-resume
- score-job-match
- suggest-priority-skills
- process-llm-queue
- backfill-embeddings
- bulk-parse-profiles

### 6.2 Job Search And Ingestion

- careerbuilder-search
- dice-search
- indeed-search
- linkedin-search
- monster-search
- receive-apify-webhook
- receive-social-job
- job-watch-trigger

### 6.3 Billing And Subscription

- razorpay-create-subscription
- razorpay-change-plan
- razorpay-webhook
- refresh-free-credits

### 6.4 Notifications And Operations

- send-notification
- notify-crm-webhook
- dashboard-summary
- admin-stats

### 6.5 Shared Runtime Utilities

- _shared utilities used by multiple functions

## 7) Environment Variables And Secret Inventory

### 7.1 Frontend Variables (import.meta.env usage)

From source scan under src:
- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY

### 7.2 Backend Variables (Deno.env usage)

From source scan under supabase/functions:
- ADMIN_PASSWORD
- APIFY_TOKEN
- CLOUDFLARE_WORKER_TOKEN
- CLOUDFLARE_WORKER_URL
- GEMINI_API_KEY
- RAZORPAY_KEY_ID
- RAZORPAY_KEY_SECRET
- RAZORPAY_WEBHOOK_SECRET
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_URL

### 7.3 Edge Function To Env-Var Mapping

- admin-stats: ADMIN_PASSWORD, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- backfill-embeddings: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- bench-match: GEMINI_API_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- bulk-parse-profiles: GEMINI_API_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- careerbuilder-search: APIFY_TOKEN, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- dashboard-summary: GEMINI_API_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- dice-search: APIFY_TOKEN, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- generate-embedding: GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- generate-search-ideas: GEMINI_API_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- indeed-search: APIFY_TOKEN, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- job-watch-trigger: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- linkedin-search: APIFY_TOKEN, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- monster-search: APIFY_TOKEN, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- notify-crm-webhook: SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- parse-resume: GEMINI_API_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- process-llm-queue: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- radar-enrich: GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- radar-match: GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- razorpay-change-plan: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- razorpay-create-subscription: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- razorpay-webhook: RAZORPAY_WEBHOOK_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- receive-apify-webhook: APIFY_TOKEN, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- receive-social-job: CLOUDFLARE_WORKER_TOKEN, CLOUDFLARE_WORKER_URL, GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- refresh-free-credits: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- rewrite-field: GEMINI_API_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- rewrite-resume: GEMINI_API_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- score-job-match: GEMINI_API_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- send-notification: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL
- suggest-priority-skills: GEMINI_API_KEY, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

## 8) Deployment And Runtime

### 8.1 Frontend Build

Source: package.json

Scripts:
- dev: vite
- build: vite build
- lint: eslint .
- preview: vite preview
- typecheck: tsc --noEmit -p tsconfig.app.json

### 8.2 Cloudflare Pages Hosting

- Deployed as static SPA bundle from dist
- SPA fallback is configured with public/_redirects:
  - /index.html 200 rewrite for unmatched routes

### 8.3 Runtime Coupling

- Frontend runtime depends on build-time VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
- Edge functions depend on Supabase service role and external provider secrets

## 9) Functional Data Flows

### 9.1 Authentication And Account Context

1. User signs in via Supabase Auth.
2. Auth context resolves active session.
3. Account membership and subscription are loaded.
4. Protected routes become available.

### 9.2 Candidate And Resume Workflows

1. Candidate profile is created/imported.
2. Resume files are uploaded and stored.
3. Parse and enrichment functions extract structured fields.
4. Profile detail and activity logs are updated.

### 9.3 Job Match Workflows

1. Jobs are searched/ingested from board functions.
2. Candidate and job context are compared by AI/matching functions.
3. Results are shown in hotlist, radar, and resume AI flows.

### 9.4 Billing And Credits

1. Billing UI triggers Razorpay create subscription function.
2. Webhooks reconcile payment lifecycle updates.
3. Credits and usage records are reflected in app billing views.

## 10) Known Implementation Notes And Documentation Gaps

Observed from code structure:
- Large page components indicate opportunities for modular extraction.
- Typed database definitions are partial compared to migration breadth.
- A single central system guide was missing prior to this document.
- Secrets are required in both frontend build and edge runtime layers.

## 11) Suggested Next Documentation Artifacts

Recommended follow-up docs:
- ERD and table-by-table data dictionary
- Edge function I/O contracts with request/response examples
- Local setup and deployment runbook
- Incident troubleshooting guide for auth, billing, and scraping failures
- Environment matrix for Development, Preview, and Production


<!-- AUTO-GENERATED:START -->
## 12) Auto-Sync Snapshot

Last synced: 2026-07-27 06:55:52 UTC

This section is generated by scripts/update-platform-doc.sh.

### 12.1 Route Snapshot

Public routes:
- /
- /about
- /admin
- /book-demo
- /cancellation-refund
- /confirm-applied/:token
- /contact
- /how-it-works
- /onboard/:token
- /pricing
- /privacy
- /security
- /signin
- /signup
- /terms
- /vs/:competitor
- /why-ai-copilot

Protected routes:
- /account
- /bench
- /billing
- /desk
- /hotlist-ai
- /job-finder
- /job-match-ai
- /profile-details/:id
- /resume-ai
- /roadmap
- /submission-queue
- /support
- /tracker
- /pulse
- /alerts

### 12.2 Frontend Environment Variables

- VITE_SUPABASE_ANON_KEY
- VITE_SUPABASE_URL

### 12.3 Backend Environment Variables

- ADMIN_PASSWORD
- APIFY_TOKEN
- CLOUDFLARE_WORKER_TOKEN
- CLOUDFLARE_WORKER_URL
- GEMINI_API_KEY
- RAZORPAY_KEY_ID
- RAZORPAY_KEY_SECRET
- RAZORPAY_WEBHOOK_SECRET
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_URL

### 12.4 Edge Function To Env Mapping

- admin-stats: ADMIN_PASSWORD,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- backfill-embeddings: SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- bench-match: GEMINI_API_KEY,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- bulk-parse-profiles: GEMINI_API_KEY,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- careerbuilder-search: APIFY_TOKEN,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- dashboard-summary: GEMINI_API_KEY,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- dice-search: APIFY_TOKEN,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- generate-embedding: GEMINI_API_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- generate-search-ideas: GEMINI_API_KEY,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- indeed-search: APIFY_TOKEN,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- job-watch-trigger: SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- linkedin-search: APIFY_TOKEN,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- monster-search: APIFY_TOKEN,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- notify-crm-webhook: SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- parse-resume: GEMINI_API_KEY,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- process-llm-queue: SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- radar-enrich: GEMINI_API_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- radar-match: GEMINI_API_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- razorpay-change-plan: RAZORPAY_KEY_ID,RAZORPAY_KEY_SECRET,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- razorpay-create-subscription: RAZORPAY_KEY_ID,RAZORPAY_KEY_SECRET,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- razorpay-webhook: RAZORPAY_WEBHOOK_SECRET,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- receive-apify-webhook: APIFY_TOKEN,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- receive-social-job: CLOUDFLARE_WORKER_TOKEN,CLOUDFLARE_WORKER_URL,GEMINI_API_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- refresh-free-credits: SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- rewrite-field: GEMINI_API_KEY,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- rewrite-resume: GEMINI_API_KEY,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- score-job-match: GEMINI_API_KEY,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- send-notification: SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL
- suggest-priority-skills: GEMINI_API_KEY,SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_URL

<!-- AUTO-GENERATED:END -->
