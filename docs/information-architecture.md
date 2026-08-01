# ProfilePush Information Architecture and Navigation Governance

Version: 1.0
Date: 2026-08-01

## 1. Purpose

This document defines the app's information architecture (IA), navigation taxonomy, and governance process for route evolution.

Goals:
- Maintain discoverability
- Prevent navigation bloat
- Keep labels consistent with user mental models

## 2. IA Model

ProfilePush IA is split into:
- Public marketing layer
- Authentication layer
- Authenticated workspace layer
- Utility/legal layer

## 3. Top-level Navigation Taxonomy

Authenticated global modules:
- Desk
- Bench
- Job Finder
- Job Watch AI
- Submission Queue
- JD AI
- Tracker
- Resume AI

Secondary support destinations:
- Support
- Roadmap
- Billing
- Account

## 4. Route Inventory

## 4.1 Public routes
- /
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

## 4.2 Bridge routes
- /onboard/:token
- /confirm-applied/:token
- /welcome

## 4.3 Protected routes
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

## 5. Navigation Principles

1. Name by user intent, not implementation
2. Keep top-level nav focused on daily workflows
3. Avoid duplicate pathways that split behavior
4. Preserve stable names once users form habits

## 6. Labeling Rules

- Use title case for module names
- Prefer concise noun phrases
- Avoid technical abbreviations unless already established (for example JD AI)
- Ensure nav labels match page titles

## 7. Entry Point Mapping

Primary entry by user intent:
- Start day and monitor work: Desk
- Manage candidates: Bench
- Discover opportunities: Job Finder
- Automate discovery: Job Watch AI
- Execute submissions: Submission Queue
- Analyze new requirement quickly: JD AI
- Track outcomes: Tracker
- Tailor resume artifacts: Resume AI

## 8. Cross-linking Requirements

Each module should deep-link to adjacent actions:
- Bench to Job Finder and Job Watch AI
- Job Finder to Submission Queue
- Submission Queue to Tracker
- Desk to all high-priority intervention routes

## 9. Search and Findability

Current recommendation:
- Add command palette or global quick search for modules and key entities

Findability requirements:
- Candidate entities searchable by name/email/role
- Jobs searchable by title/source/status

## 10. Breadcrumb Strategy

Use breadcrumbs for deep pages only:
- Profile details
- Future nested management screens

Pattern:
- Module > Entity list > Entity detail

## 11. Route and State Persistence

IA decisions support persistent heavy workflows:
- Keep major long-running modules mounted where practical
- Preserve filter and table context through route transitions

## 12. Mobile IA Considerations

- Keep core modules available via compact menu
- Prioritize read/monitor workflows on small screens
- Collapse advanced actions behind explicit menus

## 13. Governance Process for IA Changes

Any new route must include:
1. User problem statement
2. Proposed nav placement
3. Label proposal
4. Success metric
5. Migration path if replacing existing route

Approval required from:
- Product owner
- Design owner
- Engineering owner

## 14. Deprecation Policy

When removing or renaming routes:
- Provide redirects
- Maintain old route support for one release cycle where possible
- Announce in release notes

## 15. IA Quality Metrics

Track:
- module adoption by user role
- route abandonment rate
- repeat navigation loops indicating confusion
- time-to-target route for key tasks

## 16. Known IA Risks

- Top nav crowding as modules grow
- Hidden dependencies between modules reducing clarity
- Potential overlap between Bench and Resume AI semantics for new users

## 17. Roadmap for IA Evolution

Phase 1:
- Stabilize naming and cross-links
- Add page-level orientation blocks for first-time users

Phase 2:
- Introduce global command palette
- Add contextual sub-navigation in dense modules

Phase 3:
- Role-based nav tuning
- Progressive disclosure for advanced workflows

## 18. Ownership Matrix

- Product: taxonomy and prioritization
- Design: labels and discoverability validation
- Engineering: route implementation and redirects
- QA: regression checks for route access and nav behavior

## 19. Review Cadence

- Monthly nav health review
- Quarterly IA architecture review

## 20. Change Log Template

Use for each IA change:
- Date
- Change summary
- Route and label impact
- Redirects added
- Metrics to monitor
