# ProfilePush Interaction and State Matrix

Version: 1.0
Date: 2026-08-01

## 1. Purpose

This document standardizes UX behavior for all key interaction states across the application.

Goals:
- Predictable state handling
- Clear user guidance during failure
- Consistent implementation patterns

## 2. State Vocabulary

Primary states:
- idle
- loading
- success
- empty
- warning
- error
- partial
- disabled

Secondary states:
- saving
- syncing
- retrying
- stale

## 3. Global State Behavior Rules

1. Any async action over 150ms must show visible progress.
2. Any failure must offer at least one concrete next step.
3. Empty state must include a primary action where user can proceed.
4. Disable controls only when user action is truly blocked.

## 4. View-level State Matrix

## 4.1 List and table surfaces

Loading:
- Show skeleton rows
- Preserve table structure to avoid jump

Empty:
- Show reason and CTA

Partial:
- Show available rows + warning banner describing missing subset

Error:
- Show retry and optional fallback route

## 4.2 Form surfaces

Idle:
- Inputs enabled

Saving:
- Submit button shows progress
- Prevent duplicate submission

Validation error:
- Inline error per field
- Optional summary for multiple field errors

Server error:
- Non-field alert with retry guidance

Success:
- Toast or inline success confirmation

## 4.3 Multi-step workflows

Loading:
- Stepper shows active phase

Partial:
- Completed steps retained, failed step highlighted

Error:
- Stop at failed step, show retry from failed step if possible

Success:
- Explicit completion summary

## 5. Interaction State Matrix by Pattern

## 5.1 Button matrix

Default:
- Enabled and clear label

Hover:
- Distinct visual emphasis

Active:
- Tactile pressed feedback

Disabled:
- Reduced contrast, no pointer action

Loading:
- Spinner plus label retained where possible

Error follow-up:
- Return to enabled with error message context

## 5.2 Input matrix

Focus:
- Visible outline and contrast

Invalid:
- Border + error text + describedby link

Disabled:
- Readable but non-editable

Autofill/suggest:
- Suggestion list keyboard navigable

## 5.3 Dropdown matrix

Closed:
- Trigger with current value

Open:
- Focused list, arrow key support

No options:
- Empty message with recovery hint

Error loading options:
- Retry mechanism

## 5.4 Modal matrix

Open:
- Focus trap active

Submitting:
- Primary action loading and duplicate-safe

Success:
- Close with confirmation feedback

Error:
- Keep modal open with clear error explanation

## 6. Domain State Matrices

## 6.1 Resume parsing flow

States:
- upload_pending
- upload_success
- extraction_running
- extraction_partial
- extraction_failed
- profile_ready

User feedback required:
- Current step label
- Estimated wait if available
- Retry and manual edit path

## 6.2 Job search and matching

States:
- query_idle
- query_running
- source_partial_failure
- results_ready
- no_results

Feedback required:
- Source-level status markers
- Count of fetched and matched results

## 6.3 Job watch automation

States:
- schedule_idle
- run_pending
- run_running
- run_success
- run_failed

Feedback required:
- Last run time
- Next run estimate
- Failure reason and retry path

## 6.4 Submission queue

States:
- ready
- rewriting_resume
- ready_to_submit
- submitted
- submission_failed

Feedback required:
- Current stage and required next action
- Duplicate risk warning where applicable

## 7. Notification and Messaging Matrix

Toast usage:
- short-lived informational and success updates

Inline banner usage:
- persistent warnings and non-blocking failures

Modal usage:
- destructive action confirmation

## 8. Retry Strategy Guidelines

Retry availability:
- Offer immediate retry for transient network failures
- Include cooldown only where backend limits require it

Retry copy pattern:
- "We could not complete [action]. Try again."

## 9. State Persistence Rules

Persist within session:
- filter selections on heavy pages
- open detail context where feasible

Do not persist:
- stale transient errors
- sensitive temporary data after sign out

## 10. Accessibility in State Transitions

- Announce loading and completion changes where needed
- Do not remove focused elements without focus restoration
- Ensure disabled states still provide contextual explanation

## 11. Telemetry for State Quality

Track:
- failure rate by state transition
- retry rate and retry success rate
- abandonment in multi-step flows

## 12. QA Test Matrix

For every new feature validate:
- loading state
- empty state
- error state
- partial state
- success state
- retry flow
- keyboard and screen reader behavior

## 13. Implementation Checklist

Before merge:
1. State enum documented
2. UI states implemented and reviewed
3. Error copy reviewed against style guide
4. Analytics events mapped for failure and success

## 14. Known Cross-module Risks

- Inconsistent error copy in large forms
- Missing partial-success patterns in board aggregation
- Uneven retry affordances across modules

## 15. Governance

Any new state introduced must include:
- visual treatment
- copy treatment
- analytics event
- QA test scenario
