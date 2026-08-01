# ProfilePush User Journeys

Version: 1.0
Date: 2026-08-01
Status: Detailed journey map

## 1. Purpose

This document maps end-to-end user journeys for the main ProfilePush personas, including goals, trigger conditions, key decisions, failure branches, and success metrics.

## 2. Personas

### 2.1 Bench Sales Recruiter
Primary objective:
- Find and submit the best candidate to the right job quickly

Key constraints:
- High volume and time pressure
- Frequent context switching
- Need for confidence before submitting

### 2.2 Team Lead
Primary objective:
- Ensure team throughput and quality

Key constraints:
- Multi-user visibility
- Bottleneck detection
- Process consistency

### 2.3 Account Owner
Primary objective:
- Maintain operational efficiency and cost control

Key constraints:
- Billing and credits
- team health and adoption
- reliability of automation

## 3. Journey 1: Visitor to Authenticated User

Start:
- Public marketing route

User intent:
- Understand value and evaluate trust

Happy path:
1. Visitor lands on home page
2. Reviews capabilities and FAQ
3. Clicks signup/signin CTA
4. Completes auth flow
5. Lands in protected workspace

Failure branches:
- Confusing value proposition
- Auth errors
- Redirect issues

UX requirements:
- Fast route transitions
- Clear CTA hierarchy
- Helpful auth error copy

Metrics:
- Visitor-to-signup conversion
- Signup completion rate
- First protected-route visit rate

## 4. Journey 2: Candidate Ingestion and Bench Readiness

Persona:
- Recruiter

Start trigger:
- New candidate arrives via resume, sheet, or manual entry

Happy path:
1. Open Bench
2. Upload or paste candidate data
3. Parsing and extraction runs
4. Recruiter verifies key fields
5. Candidate assigned stage and owner
6. Candidate saved and appears in list

Decision points:
- Is parsed data trusted enough?
- Is candidate hotlist-eligible?
- Is location normalized correctly?

Failure branches:
- Parse fails
- Invalid file format
- Missing required fields
- Location API failure

Recovery UX:
- Step-level error messages
- Manual correction mode
- Retry parse action

Success metrics:
- Time from upload to profile ready
- Parse correction rate
- Candidate save success rate

## 5. Journey 3: Search to Submission Queue

Persona:
- Recruiter

Start trigger:
- Recruiter needs fresh opportunities for selected candidates

Happy path:
1. Open Job Finder
2. Apply search criteria
3. Review multi-board results
4. Inspect AI match signals
5. Save promising jobs
6. Navigate to Submission Queue

Decision points:
- Which score threshold to trust?
- Which board yields best quality for this candidate?

Failure branches:
- External board fetch partial failure
- Match scoring unavailable
- Duplicate save detection

Recovery UX:
- Source-level failure indicators
- Retry action by source
- Duplicate-safe save messaging

Success metrics:
- Search-to-save conversion
- Saved jobs per session
- High-score save ratio

## 6. Journey 4: Submission Execution

Persona:
- Recruiter

Start trigger:
- Candidate-job pair enters Submission Queue

Happy path:
1. Open Submission Queue
2. Verify match rationale
3. Trigger resume rewrite where needed
4. Prepare outreach/email assets
5. Mark submitted
6. Entry appears in Tracker

Decision points:
- Is rewrite required?
- Is confidence acceptable?
- Is duplicate submission risk present?

Failure branches:
- Resume rewrite service failure
- Missing candidate data
- Submission destination ambiguity

Recovery UX:
- Non-blocking partial completion
- Manual fallback option
- Explicit audit fields for who submitted and when

Success metrics:
- Time from save to submit
- Submission per recruiter/day
- Post-submit interview rate

## 7. Journey 5: Job Watch Automation

Persona:
- Recruiter and Team Lead

Start trigger:
- User configures watch schedule

Happy path:
1. Open Job Watch AI
2. Configure schedule and scope
3. Wait for periodic runs
4. Receive notifications
5. Review generated opportunities
6. Move opportunities into active workflows

Decision points:
- Frequency choice
- Candidate-level vs broader scope
- Handling no-result runs

Failure branches:
- Schedule misconfiguration
- Cron/runtime failures
- Data freshness issues

Recovery UX:
- Run history visibility
- Clear error diagnostics
- Manual trigger option for urgent scenarios

Success metrics:
- Successful run percentage
- Jobs discovered per run
- Notification-to-action rate

## 8. Journey 6: Team Lead Daily Review

Persona:
- Team Lead

Start trigger:
- Start-of-day or end-of-day check

Happy path:
1. Open Desk dashboard
2. Review KPIs and pipeline stages
3. Spot stagnation or low activity
4. Drill into Bench/Tracker for intervention
5. Reassign or reprioritize tasks

Failure branches:
- Insufficient context in KPI cards
- Lack of actionable drill-down paths

Success metrics:
- Time to detect bottlenecks
- Stage progression velocity
- Team intervention impact

## 9. Journey 7: Billing and Credits Management

Persona:
- Account Owner

Start trigger:
- Low credits or plan reassessment

Happy path:
1. Observe credit warning in header
2. Open Billing
3. Review current plan and usage
4. Upgrade or top-up
5. Continue workflow without interruption

Failure branches:
- Payment error
- Plan mismatch confusion

Recovery UX:
- Precise payment error messaging
- Support escalation path

Success metrics:
- Top-up completion rate
- Low-credit interruption rate

## 10. Journey 8: Candidate Onboarding via Token

Persona:
- Candidate (external)

Start trigger:
- Receives onboarding token link

Happy path:
1. Opens tokenized onboarding route
2. Completes required fields
3. Confirmation route reached
4. Recruiter receives updated candidate data

Failure branches:
- Expired token
- Invalid token
- Partial completion

Recovery UX:
- Token-specific error guidance
- Reissue flow for recruiter

Success metrics:
- Onboarding completion rate
- Average completion time

## 11. Cross-Journey UX Friction Points

Primary friction risks:
- Inconsistent state behavior across modules
- Limited transparency when AI operations partially fail
- Dense interfaces with small controls for novice users

Mitigation priorities:
1. Standardize loading/empty/error templates
2. Improve rationale visibility for AI actions
3. Add contextual inline help in power workflows

## 12. Instrumentation Plan by Journey

Each journey should emit:
- start event
- key transition events
- failure events with reason
- completion event

Required fields:
- user_id
- account_id
- module
- route
- timestamp
- outcome

## 13. Journey Acceptance Criteria

A journey is considered healthy when:
- Completion rate reaches predefined threshold
- Time-to-completion meets benchmark
- Error rates remain below alert threshold
- Qualitative user feedback indicates confidence and speed

## 14. Prioritized Journey Optimization Backlog

Priority 1:
- Ingestion and parse correction improvements
- Search-to-submission cycle compression

Priority 2:
- Watch run transparency and interventions
- Team lead drill-downs from desk metrics

Priority 3:
- Candidate onboarding friction reduction
- Billing path trust and clarity improvements

## 15. Journey Review Cadence

Suggested cadence:
- Weekly tactical review for high-volume journeys
- Monthly strategic review by persona
- Quarterly IA and navigation recalibration
