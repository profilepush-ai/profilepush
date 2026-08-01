# ProfilePush Analytics Event Taxonomy

Version: 1.0
Date: 2026-08-01
Status: Detailed analytics baseline

## 1. Purpose

This document defines a standardized event taxonomy for Product Analytics, UX quality monitoring, and operational reporting.

Goals:
- Consistent event naming
- Reliable funnel measurement
- Clear ownership and data quality controls

## 2. Event Design Principles

1. Track user intent and outcome, not only clicks
2. Keep naming predictable and semantic
3. Include context fields required for analysis
4. Separate system telemetry from user behavior events
5. Version changes to avoid breaking dashboards

## 3. Naming Convention

Format:
- domain.object.action

Examples:
- auth.session.started
- bench.profile.created
- jobs.search.executed
- submission.item.marked_submitted

Rules:
- Lowercase snake_case values in payload fields
- Avoid ambiguous verbs like done or complete without context

## 4. Common Event Envelope

Required base fields for all events:
- event_name
- event_version
- event_timestamp_utc
- user_id (nullable for anonymous routes)
- account_id (nullable for anonymous routes)
- session_id
- route
- module
- environment (local, staging, production)
- client_platform (web)

Optional cross-cutting fields:
- request_id
- correlation_id
- experiment_id
- plan_tier

## 5. Domain Event Catalog

## 5.1 Authentication domain

Events:
- auth.page.viewed
- auth.signin.started
- auth.signin.succeeded
- auth.signin.failed
- auth.signup.started
- auth.signup.succeeded
- auth.signup.failed
- auth.oauth.started
- auth.oauth.succeeded
- auth.oauth.failed
- auth.password_reset.requested

Key payload fields:
- auth_provider
- failure_reason
- redirect_target

## 5.2 Bench domain

Events:
- bench.page.viewed
- bench.profile_upload.started
- bench.profile_upload.succeeded
- bench.profile_upload.failed
- bench.parse.started
- bench.parse.succeeded
- bench.parse.failed
- bench.profile.created
- bench.profile.updated
- bench.profile.deleted
- bench.profile.stage_changed
- bench.profile.assigned
- bench.hotlist.added
- bench.hotlist.removed

Key payload fields:
- profile_id
- source_type (upload, manual, import)
- parse_duration_ms
- stage_from
- stage_to

## 5.3 Job Finder domain

Events:
- jobs.finder.viewed
- jobs.search.executed
- jobs.search.succeeded
- jobs.search.failed
- jobs.result.opened
- jobs.result.saved
- jobs.result.unsaved

Key payload fields:
- query_id
- sources_requested
- sources_succeeded
- sources_failed
- total_results
- matched_results

## 5.4 Job Watch domain

Events:
- watch.page.viewed
- watch.schedule.created
- watch.schedule.updated
- watch.schedule.toggled
- watch.schedule.deleted
- watch.run.triggered
- watch.run.succeeded
- watch.run.failed
- watch.notification.clicked

Key payload fields:
- schedule_id
- frequency
- run_id
- jobs_matched
- run_duration_ms
- failure_reason

## 5.5 Submission Queue domain

Events:
- submission.queue.viewed
- submission.item.opened
- submission.item.resume_rewrite_started
- submission.item.resume_rewrite_succeeded
- submission.item.resume_rewrite_failed
- submission.item.marked_submitted
- submission.item.reverted

Key payload fields:
- submission_item_id
- profile_id
- job_id
- match_score
- rewrite_duration_ms

## 5.6 JD AI domain

Events:
- jd_ai.page.viewed
- jd_ai.input.submitted
- jd_ai.parse.succeeded
- jd_ai.parse.failed
- jd_ai.match.started
- jd_ai.match.succeeded
- jd_ai.match.failed
- jd_ai.shortlist.exported

Key payload fields:
- jd_input_type (paste, file)
- candidate_count
- top_score

## 5.7 Resume AI domain

Events:
- resume_ai.page.viewed
- resume_ai.rewrite.started
- resume_ai.rewrite.succeeded
- resume_ai.rewrite.failed
- resume_ai.rewrite.applied
- resume_ai.exported

Key payload fields:
- rewrite_id
- strategy_type
- duration_ms

## 5.8 Tracker domain

Events:
- tracker.page.viewed
- tracker.record.created
- tracker.record.updated
- tracker.record.status_changed
- tracker.record.exported

Key payload fields:
- tracker_record_id
- previous_status
- current_status

## 5.9 Billing domain

Events:
- billing.page.viewed
- billing.plan_viewed
- billing.plan_selected
- billing.checkout_started
- billing.checkout_succeeded
- billing.checkout_failed
- billing.topup_started
- billing.topup_succeeded
- billing.topup_failed

Key payload fields:
- plan_id
- amount
- currency
- payment_provider
- failure_reason

## 6. Funnel Definitions

## 6.1 Candidate activation funnel
- bench.profile_upload.started
- bench.parse.succeeded
- bench.profile.created
- bench.hotlist.added

## 6.2 Search to submit funnel
- jobs.search.executed
- jobs.result.saved
- submission.item.opened
- submission.item.marked_submitted

## 6.3 Watch automation funnel
- watch.schedule.created
- watch.run.succeeded
- watch.notification.clicked
- submission.item.marked_submitted

## 7. Error Taxonomy

Standard failure_reason values:
- network_error
- auth_error
- validation_error
- provider_error
- timeout
- rate_limited
- unknown

Rules:
- Always map raw errors to canonical reasons
- Preserve raw_error_code in separate field where safe

## 8. Privacy and Security Constraints

Do not send:
- raw resumes
- full candidate PII in event payloads
- auth tokens or secret keys

Allowable identifiers:
- internal IDs
- masked or hashed references where required

## 9. Event Versioning

- event_version starts at 1
- Increment major version for breaking payload shape changes
- Keep old and new versions concurrently supported during migration window

## 10. Data Quality Controls

Validation checks:
- required fields present
- enum values valid
- timestamp format valid
- event size under limit

Monitoring:
- dropped event rate
- invalid schema rate
- latency to analytics sink

## 11. Dashboard Mapping

Recommended dashboard groups:
- Activation and onboarding
- Core productivity workflows
- Automation reliability
- Conversion and revenue
- Error health by module

## 12. Ownership Model

- Product Analytics: taxonomy governance
- Engineering: instrumentation and schema adherence
- Data Engineering: ingestion and warehouse quality
- Product: metric definition and interpretation

## 13. Implementation Checklist

For each new feature:
1. Define events and payloads
2. Add schema validation tests
3. Add dashboard or report mapping
4. Verify no sensitive fields leak

## 14. Change Management

When changing events:
- Update this file
- Mark deprecated events with sunset date
- Communicate changes to dashboard owners

## 15. Event Registry Template

For each event record:
- Name
- Domain
- Description
- Trigger condition
- Required payload fields
- Optional payload fields
- Owner
- Version
- Created date
- Last updated date
