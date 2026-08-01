# UX Acceptance Criteria Template

Version: 1.0
Date: 2026-08-01
Usage: Attach to product stories, epics, and release QA checklists

## 1. Purpose

This template ensures all shipped features meet baseline UX quality across usability, consistency, accessibility, and resilience.

## 2. How to Use

1. Copy this template into each feature spec or ticket.
2. Fill all required sections before development starts.
3. Validate each criterion during QA.
4. Mark pass/fail with evidence links.

## 3. Feature Metadata

- Feature name:
- Module:
- Route(s):
- Story/issue link:
- Owner (PM):
- Owner (Design):
- Owner (Engineering):
- QA owner:
- Release target:

## 4. User Goal and Context

- Primary user persona:
- User goal:
- Trigger scenario:
- Frequency of use:
- Business impact if feature fails:

## 5. Functional UX Criteria

Required checks:
- [ ] Core task can be completed end-to-end without dead ends
- [ ] Navigation path to feature is discoverable
- [ ] Primary and secondary actions are clear
- [ ] System feedback appears for every major action
- [ ] Undo or safe recovery exists where needed

Evidence:
- Screenshots:
- Notes:

## 6. Visual and Consistency Criteria

Required checks:
- [ ] Uses approved design tokens and spacing rhythm
- [ ] Typography hierarchy follows standards
- [ ] Status colors use semantic mapping
- [ ] Components match existing pattern behavior
- [ ] No visual regressions in adjacent screens

Evidence:
- Before/after images:
- QA notes:

## 7. Interaction State Criteria

Validate each state:
- [ ] idle
- [ ] loading
- [ ] success
- [ ] empty
- [ ] warning
- [ ] error
- [ ] partial success/failure
- [ ] disabled

Required checks:
- [ ] Each state provides clear user guidance
- [ ] Retry path exists for recoverable failures
- [ ] Transitions do not cause layout instability

Evidence:
- Test cases:
- Logs or videos:

## 8. Form and Validation Criteria (if applicable)

Required checks:
- [ ] Every input has visible label
- [ ] Required fields clearly marked
- [ ] Inline validation messages are actionable
- [ ] Submit disabled only when appropriate
- [ ] Server errors mapped to user-friendly copy

Evidence:
- Validation screenshots:
- Error examples:

## 9. Accessibility Criteria

Required checks:
- [ ] Keyboard-only completion is possible
- [ ] Focus order and focus-visible ring are correct
- [ ] Icon-only controls include accessible labels
- [ ] Screen reader announcements are meaningful
- [ ] Contrast meets WCAG 2.2 AA targets

Evidence:
- Accessibility test report:
- Assistive tech notes:

## 10. Responsive Criteria

Required breakpoints:
- [ ] Desktop
- [ ] Tablet
- [ ] Mobile

Required checks:
- [ ] No blocking overflow issues
- [ ] Core actions remain accessible
- [ ] Readability remains acceptable

Evidence:
- Screenshot set:
- Device/browser list:

## 11. Content and Microcopy Criteria

Required checks:
- [ ] Terminology matches style guide
- [ ] Action labels are specific verbs
- [ ] Error and success messages are concise and actionable
- [ ] No internal jargon exposed to users

Evidence:
- Copy review notes:

## 12. Performance UX Criteria

Required checks:
- [ ] Loading indicator appears quickly for async actions
- [ ] Perceived route transition is acceptable
- [ ] Long tasks show progress where feasible
- [ ] No unnecessary blocking on background tasks

Evidence:
- Performance traces:
- User perception notes:

## 13. Analytics Criteria

Required checks:
- [ ] Events are instrumented for start, success, and failure
- [ ] Payload fields follow event taxonomy
- [ ] No sensitive data leaked
- [ ] Dashboard mapping confirmed

Evidence:
- Event logs:
- Dashboard link:

## 14. Error and Recovery Criteria

Required checks:
- [ ] Failures are communicated clearly
- [ ] Retry behavior works
- [ ] Partial failures preserve successful work
- [ ] Escalation/support path is visible when needed

Evidence:
- Failure simulations:
- Recovery tests:

## 15. Security and Trust UX Criteria

Required checks:
- [ ] Destructive actions use explicit confirmation
- [ ] Permission limitations are clearly explained
- [ ] User-facing audit details shown where relevant

Evidence:
- Confirmation flow screenshots:
- Permission test notes:

## 16. Release Readiness Decision

Summary:
- Pass/Fail:
- Blocking issues:
- Non-blocking issues:
- Risk level (low/medium/high):

Approvals:
- PM signoff:
- Design signoff:
- Engineering signoff:
- QA signoff:

## 17. Post-release Validation

Within 72 hours after release verify:
- [ ] No major UX regressions reported
- [ ] Event telemetry quality is healthy
- [ ] Key funnel completion rates stable
- [ ] Error rates within expected range

Notes:

## 18. Reusable Test Scenario Grid

Scenario template:
- Scenario ID:
- Persona:
- Preconditions:
- Action steps:
- Expected UX behavior:
- Result:
- Evidence link:

## 19. Severity and Triage Matrix

Critical:
- Blocks core task completion

High:
- Significant confusion or repeated failure risk

Medium:
- Workaround exists but UX quality degraded

Low:
- Cosmetic or minor copy/polish issue

## 20. Change Log

- Date:
- Section changed:
- Reason:
- Updated by:
