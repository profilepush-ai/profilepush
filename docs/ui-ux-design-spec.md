# ProfilePush UI and UX Design Specification

Version: 1.0
Date: 2026-08-01
Product: ProfilePush
Scope: Web application (marketing + authenticated recruiter workspace)

## 1. Purpose

This document defines the current and target UI/UX architecture for ProfilePush so product, engineering, design, and QA can implement consistent, high-confidence experiences across all modules.

It is intended to be:
- A source of truth for interaction and visual behavior
- A handoff artifact for new contributors
- A quality baseline for future feature delivery

## 2. Product Context

ProfilePush is an AI copilot for bench sales recruiters and staffing teams. The platform spans:
- Marketing and conversion pages
- Authentication and onboarding
- Authenticated workspace for candidate management, job search, AI matching, job watch automation, submission queue, resume AI, tracker, and account operations

Primary user outcomes:
- Add and maintain candidate inventory quickly
- Discover high-fit jobs faster across boards
- Submit candidates faster with better matching confidence
- Track pipeline and team activity with lower operational overhead

## 3. User Segments

### 3.1 Core users
- Bench Sales Recruiter
- Team Lead / Delivery Manager
- Account Owner / Admin
- Operations or Analyst persona

### 3.2 Secondary users
- Marketing visitor (future customer)
- Candidate receiving onboarding link

### 3.3 Environment assumptions
- Heavy desktop usage during work hours
- Browser tab concurrency is high
- Time-sensitive workflows
- Frequent context switching between profiles, jobs, and communications

## 4. UX Principles

### 4.1 Speed over ceremony
- Primary tasks should be 3-5 actions max
- Bulk actions preferred where possible

### 4.2 Immediate clarity
- Every screen answers: What can I do here now?
- Critical status and next action should be visible above the fold

### 4.3 Trustworthy automation
- AI outputs must be explainable with confidence signals
- Users must be able to override AI suggestions

### 4.4 Operational continuity
- Preserve task context across route changes where possible
- Protect against accidental data loss in long workflows

### 4.5 Scalable consistency
- Reuse shell, spacing, status colors, and state behavior patterns across modules

## 5. Information Architecture

## 5.1 Route map

### Public and marketing
- / (Landing)
- /signup
- /signin
- /reset-password
- /privacy
- /terms
- /security
- /about
- /contact
- /pricing
- /cancellation-refund
- /vs/:competitor
- /book-demo
- /why-ai-copilot
- /how-it-works
- /admin

### Candidate and auth bridge routes
- /onboard/:token
- /confirm-applied/:token
- /welcome

### Authenticated workspace
- /desk
- /bench
- /profile-details/:id
- /job-finder
- /job-watch-ai
- /submission-queue
- /jd-ai
- /tracker
- /resume-ai
- /account
- /support
- /roadmap
- /billing

Source reference:
- [src/App.tsx](../src/App.tsx)

## 5.2 Global navigation model

Top app nav includes:
- Desk
- Bench
- Job Finder
- Job Watch AI
- Submission Queue
- JD AI
- Tracker
- Resume AI
- Support
- Roadmap
- Credits chip
- Notifications
- Account menu

Source reference:
- [src/components/AppNav.tsx](../src/components/AppNav.tsx)

## 5.3 Route persistence behavior

The following heavy pages remain mounted to preserve state while hidden:
- Job Finder
- Submission Queue
- Resume AI

This is a strong UX decision for high-effort workflows and should be retained.

Source reference:
- [src/App.tsx](../src/App.tsx)

## 6. Global Shell and Layout

## 6.1 Shell anatomy
- Header nav with quick-access global actions
- Content region module-specific
- Toast/notification channel
- Loading spinner fallback for route-level lazy chunks

## 6.2 Spacing rhythm
Current style suggests a compact productivity density:
- Small text sizes in nav and controls
- Tight vertical spacing
- Emphasis on data density over large marketing-style spacing

Recommendation:
- Maintain compact mode for authenticated app
- Keep comfortable mode for marketing pages

## 6.3 Z-index hierarchy
Suggested stack order:
1. Content base
2. Sticky module bars
3. Header
4. Dropdowns and popovers
5. Modal dialogs
6. Global overlays

## 7. Visual Language

## 7.1 Current state
The app uses Tailwind utility styling with a neutral base and semantic accent colors.

Base characteristics:
- Surface: white, gray, slate
- Accent: blue primary actions
- Status: red/amber/emerald/violet/sky in task contexts

Source references:
- [src/index.css](../src/index.css)
- [src/components/AppNav.tsx](../src/components/AppNav.tsx)
- [src/pages/ProfilesDirectory.tsx](../src/pages/ProfilesDirectory.tsx)

## 7.2 Semantic color system
Define and enforce these semantic categories:
- primary
- success
- warning
- danger
- info
- neutral
- focus

Each category should have:
- fg
- bg
- border
- hover
- subtle
- contrast pairing

## 7.3 Typography
Current app uses utility classes without a formal type spec.

Recommended tokenized scale:
- display-lg (marketing hero)
- heading-xl, heading-lg, heading-md
- title-sm
- body-md, body-sm
- caption
- mono-sm

Rules:
- Body copy minimum 14px for readability in dense screens
- Avoid tiny text for critical actions
- Numeric KPI labels may use tighter sizing if high contrast

## 7.4 Iconography
Current icon set uses lucide and is consistent in style.

Rules:
- Icon-only actions require visible tooltip and accessible label
- Keep icon size per control tier:
  - tiny 10-12
  - normal 14-16
  - emphasis 18-20

## 7.5 Motion
Current animation usage is minimal and fast.

Source reference:
- [src/index.css](../src/index.css)

Motion rules:
- Use motion to clarify state transition, not decoration
- Keep durations short in work surfaces
- Respect reduced motion preference

## 8. Component and Pattern Inventory

## 8.1 Global components
- AppNav
- ProtectedRoute
- ErrorBoundary
- Toast
- Logo and LogoSpinner
- LocationAutosuggestInput
- PlanModal
- SEO
- SiteFooter

Source reference:
- [src/components](../src/components)

## 8.2 Pattern classes to formalize
- Compact tabs and pills
- Data table row action patterns
- Candidate card list patterns
- Notification drawer
- Credit balance signal chip
- Empty state with single primary CTA
- Multi-step processing indicator

## 8.3 Required standard states for every reusable component
- default
- hover
- active
- focus-visible
- disabled
- loading
- error
- empty

## 9. Page-level UX Specifications

## 9.1 Marketing pages

Pages:
- Landing
- Pricing
- Why AI Copilot
- How It Works
- Comparison
- About
- Contact
- Book Demo

Expected behavior:
- Strong conversion path to signup and demo
- Product capability explained with proof artifacts
- FAQ and trust signals near conversion CTAs

Source reference:
- [src/pages/LandingPage.tsx](../src/pages/LandingPage.tsx)

## 9.2 Authentication

Pages:
- Sign In
- Sign Up
- Reset Password

UX requirements:
- Explicit error normalization and actionable messages
- Social auth and password auth parity
- Safe redirect behavior
- Loading and retry handling

Source reference:
- [src/pages/SignIn.tsx](../src/pages/SignIn.tsx)

## 9.3 Desk

Primary goal:
- Daily command center for recruiter or team lead

Key artifacts:
- KPIs
- activity and trend summaries
- watch and pipeline health signals

Design requirements:
- Above-the-fold executive summary
- drill-down cards linking to operational modules
- clear date filters and timezone visibility

## 9.4 Bench

Primary goal:
- Candidate system of record and hotlist operations

Observed complexity:
- Profile ingestion
- Parsing workflow
- Multi-stage bench pipeline
- Team assignment
- Date presets
- Location normalization

Source reference:
- [src/pages/ProfilesDirectory.tsx](../src/pages/ProfilesDirectory.tsx)

Required UX structure:
- Left primary work area for list and actions
- Right contextual panel for profile details and quick edits
- Deterministic stage filters and date filters
- Batch actions for repetitive updates

## 9.5 Profile Details

Primary goal:
- Deep profile edit and evidence review

Requirements:
- Resume-derived fields with confidence and provenance indicators
- canonical contact and location section
- assignment, stage, and activity timeline
- job matching and submission linkage

## 9.6 Job Finder

Primary goal:
- Search jobs across boards and triage high-fit opportunities

Requirements:
- unified query builder
- board/source segmentation
- AI match score visibility
- save and route to submission queue
- state persistence across route changes

## 9.7 Job Watch AI

Primary goal:
- Scheduled discovery and matching without manual polling

Requirements:
- schedule visibility and status
- run history and error transparency
- per-profile and global watch controls
- clear explanation of cadence and data freshness

## 9.8 Submission Queue

Primary goal:
- Convert matched opportunities into high-quality submissions

Requirements:
- candidate-job pairing clarity
- resume rewrite and pitch support
- explicit submission status transitions
- anti-duplication and audit trail confidence

## 9.9 JD AI

Primary goal:
- Parse job descriptions and find best-fit candidates quickly

Requirements:
- paste or upload JD
- extraction preview and editable criteria
- ranking transparency
- direct action to shortlist and outreach

## 9.10 Resume AI

Primary goal:
- Optimize candidate resumes for target jobs

Requirements:
- before/after diff view
- skill gap resolution suggestions
- one-click export/share
- preserve original and revision history

## 9.11 Tracker

Primary goal:
- Pipeline visibility for submissions and outcomes

Requirements:
- status funnel
- account/vendor/client context
- timeline and reminders
- ownership and accountability markers

## 9.12 Account, Billing, Support, Roadmap

Account:
- org and user settings
- notification preferences

Billing:
- credits and plan details
- low-balance warnings and top-up paths

Support and Roadmap:
- issue routing and feature feedback
- product communication loop

## 10. Key User Workflows

## 10.1 Candidate onboarding workflow
1. Ingest profile or resume
2. Parse and structure candidate fields
3. Normalize location and skills
4. Assign stage and owner
5. Add to hotlist where relevant

Success metrics:
- time to profile ready
- parse completion rate
- manual correction ratio

## 10.2 Search-to-submission workflow
1. Open Job Finder
2. Run board search
3. Evaluate AI match score
4. Save opportunities
5. Move to Submission Queue
6. Rewrite resume and submit
7. Log final submission

Success metrics:
- search to submit cycle time
- submissions per recruiter per day
- match quality to interview conversion

## 10.3 Watch automation workflow
1. Configure watch schedule
2. Trigger periodic matching
3. Review run output and notifications
4. Promote candidates/jobs into active queue

Success metrics:
- successful run rate
- jobs discovered per cycle
- actionable notifications ratio

## 11. UX States and Behavior Matrix

Every feature surface must define:
- Initial loading state
- Empty state
- Partial data state
- Soft failure state with retry
- Hard failure state with escalation path
- Success confirmation state

### State messaging rules
- No generic unknown error text
- Every error has next action text
- User-facing terms avoid internal technical jargon

## 12. Accessibility Requirements

## 12.1 Baseline standards
- WCAG 2.2 AA target
- Keyboard-first navigation for all workflows
- Focus-visible ring on every interactive element
- Semantic headings and landmarks

## 12.2 Control-level requirements
- Icon-only buttons need aria-label
- Inputs have explicit labels and error association
- Toast and notifications use appropriate live regions
- Modal dialogs trap focus and restore focus on close

## 12.3 Color and contrast
- Body and key data text meet contrast thresholds
- State communicated by text or icon, not color alone

## 13. Responsive Behavior

Breakpoints should support:
- Desktop primary workflow mode
- Tablet constrained productivity mode
- Mobile monitoring and light action mode

Guidelines:
- Data-dense workflows can simplify on mobile but must preserve key actions
- Sticky action bars for mobile forms
- Avoid horizontal overflow in tables; provide controlled collapse strategies

## 14. Content Design and Microcopy

Tone profile:
- confident
- concise
- operational
- supportive, not verbose

Microcopy requirements:
- primary action labels are verbs
- helper text explains consequences
- destructive actions include confirmation context

## 15. Performance UX

Targets:
- route transition perceived latency under 300ms where possible
- skeleton or spinner visible within 150ms on async operations
- preserve expensive page state for heavy workflows

Current positive pattern:
- persistent mount for Job Finder, Submission Queue, Resume AI

Source reference:
- [src/App.tsx](../src/App.tsx)

## 16. Analytics and Product Instrumentation UX

Minimum event model:
- page_view
- module_entry
- primary_action_click
- task_complete
- task_fail
- retry

Workflow-level event chains required for:
- profile ingest
- search to save
- save to submit
- watch run outcomes
- billing conversion and top-up

## 17. Security and Trust UX

- Surface data access context in team workflows
- Make irreversible operations explicit
- Preserve user confidence with clear audit feedback
- Avoid exposing internal secret-handling details in UI

## 18. Design QA Checklist

Each release should validate:
- Navigation consistency
- Spacing and typography token usage
- Loading and error states per module
- Keyboard and screen reader checks
- Mobile layout checks for critical routes
- Performance smoke checks on heavy pages

## 19. Current UX Risks and Opportunities

## 19.1 Risks
- Very large page modules may create maintainability and consistency drift risk
- Some dense controls use very small text sizes that may hurt readability
- Route-level feature complexity can create state and discoverability debt without a strict pattern library

## 19.2 Opportunities
- Extract shared workspace layout primitives
- Standardize form field wrappers and table controls
- Introduce a documented design token layer beyond ad hoc utility choices
- Add workflow playbooks inside app help for new team onboarding

## 20. Documentation Needed Next

The following documents should be created to operationalize this spec.

### 20.1 Design system token spec
- File suggestion: docs/design-system-tokens.md
- Defines colors, spacing, typography, radius, shadows, z-index, motion, and semantic mappings

### 20.2 Component spec library
- File suggestion: docs/component-specs.md
- Usage rules, states, dos and donts, a11y annotations for each shared component

### 20.3 User flow and journey map
- File suggestion: docs/user-journeys.md
- End-to-end journeys per persona, with happy paths and failure branches

### 20.4 Content and microcopy guide
- File suggestion: docs/content-style-guide.md
- Voice and tone, error copy patterns, CTA naming conventions, notification templates

### 20.5 Accessibility conformance plan
- File suggestion: docs/accessibility-plan.md
- WCAG checklist by route, audit cadence, remediation ownership

### 20.6 Interaction and state model
- File suggestion: docs/interaction-state-matrix.md
- Standardized state behaviors for loading, empty, errors, retries, and confirmations

### 20.7 Information architecture and navigation governance
- File suggestion: docs/information-architecture.md
- Route ownership, nav taxonomy, naming conventions, menu governance process

### 20.8 Product telemetry and event taxonomy
- File suggestion: docs/analytics-event-taxonomy.md
- Event names, payload schema, dashboards, quality guardrails

### 20.9 Onboarding and training playbook
- File suggestion: docs/recruiter-onboarding-playbook.md
- Module-by-module training path and measurable proficiency milestones

### 20.10 UX acceptance criteria template
- File suggestion: docs/ux-acceptance-criteria-template.md
- Reusable checklist for engineering stories and QA signoff

## 21. Appendix: Source References

- [src/App.tsx](../src/App.tsx)
- [src/index.css](../src/index.css)
- [src/components/AppNav.tsx](../src/components/AppNav.tsx)
- [src/pages/LandingPage.tsx](../src/pages/LandingPage.tsx)
- [src/pages/SignIn.tsx](../src/pages/SignIn.tsx)
- [src/pages/ProfilesDirectory.tsx](../src/pages/ProfilesDirectory.tsx)
- [src/pages](../src/pages)
- [src/components](../src/components)
