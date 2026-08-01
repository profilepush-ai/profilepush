# ProfilePush Accessibility Conformance Plan

Version: 1.0
Date: 2026-08-01
Target standard: WCAG 2.2 AA

## 1. Purpose

This plan defines how ProfilePush reaches and maintains accessibility conformance across marketing and authenticated workflows.

## 2. Conformance Scope

In scope:
- Public marketing routes
- Authentication routes
- Protected app routes
- Shared components

Out of scope (for this version):
- Native mobile apps (none currently)

## 3. Accessibility Principles

1. Keyboard first for all workflows
2. Information must not rely on color alone
3. Screen reader path must be complete and understandable
4. Focus must always be visible
5. Error states must be actionable and announced

## 4. Baseline Requirements by Area

## 4.1 Navigation and shell
- Landmark roles present (header, nav, main, footer)
- Skip-to-content link available
- Active nav item indicated semantically

## 4.2 Forms
- Every input has associated label
- Error messages linked through aria-describedby
- Required state communicated textually and semantically

## 4.3 Data tables and lists
- Semantic table structure where tabular
- Column headers and scope attributes
- Row actions keyboard reachable

## 4.4 Overlays
- Modals trap focus
- Escape closes where allowed
- Focus returns to trigger on close

## 4.5 Notifications and status
- Live region behavior for async updates
- Success and error events announced appropriately

## 5. Route-level Checklist

## 5.1 Public routes
- Page title reflects route purpose
- Heading hierarchy valid (single H1 expected)
- CTA controls keyboard and screen-reader clear

## 5.2 Auth routes
- Error messages announced and clear
- Password visibility toggle properly labeled
- OAuth options announced as equivalent auth paths

## 5.3 Bench and profile routes
- Dense controls remain keyboard reachable
- Upload and parse progress communicated
- Stage and status chips include text meaning

## 5.4 Job Finder and Queue routes
- Filters and results updates announced
- Sorting state announced
- Row selection clearly communicated

## 5.5 Watch and tracker routes
- Schedule and run statuses include explicit text labels
- Time and timezone visibility readable

## 6. Keyboard Interaction Standards

Required keys:
- Tab and Shift+Tab for traversal
- Enter and Space for activation
- Escape for overlays and dismissible panels
- Arrow keys for menu/listbox navigation where relevant

No keyboard trap allowed outside intended modal context.

## 7. Screen Reader Expectations

Recommended testing tools:
- VoiceOver on macOS
- NVDA on Windows

Core test scenarios:
- Sign in and sign up
- Add profile and save
- Run search and save result
- Open notification drawer and mark read

## 8. Color and Contrast Plan

Minimum contrast:
- Body text: 4.5:1
- Large text and icons: 3:1
- Focus outline: 3:1 against adjacent color

Testing:
- Automated contrast checks in CI where possible
- Manual verification for custom gradients and overlays

## 9. Motion and Reduced Motion

Requirements:
- Respect prefers-reduced-motion
- Avoid motion that communicates essential info only through animation
- Keep motion subtle in productivity contexts

## 10. Accessible Error Handling

Error patterns:
- Inline field errors near input
- Page-level summary for multi-field errors
- Actionable next step in each message

Do not:
- Use only color changes without text
- Hide critical errors in toast only

## 11. Tooling and Automation

Recommended tools:
- eslint-plugin-jsx-a11y
- axe-core integration in E2E tests
- Lighthouse accessibility checks for public routes

CI gates:
- No new critical accessibility violations
- No regressions in core path checks

## 12. Manual Audit Cadence

Suggested cadence:
- Sprint-level checks for touched modules
- Monthly cross-route audit
- Quarterly deep audit with assistive tech sessions

## 13. Defect Severity Model

Critical:
- Blocks keyboard-only completion of core task
- Missing form labels on critical inputs

High:
- Screen reader ambiguity in key workflows
- Focus loss after major action

Medium:
- Non-blocking contrast or semantics issues

Low:
- Minor wording or redundant announcement issues

## 14. Ownership Model

- Design: patterns and acceptance criteria
- Engineering: implementation and unit/integration coverage
- QA: verification and regression tracking
- Product: prioritization and release gate decisions

## 15. Accessibility Acceptance Criteria Template

For each feature story:
1. Keyboard path documented
2. Screen reader labels verified
3. Focus behavior verified
4. Error messaging verified
5. Contrast verified

## 16. Immediate Remediation Backlog

Priority 1:
- Ensure icon-only controls have explicit labels
- Verify dropdown and drawer keyboard closing paths
- Add/verify skip link behavior

Priority 2:
- Standardize error association in dense forms
- Validate all status chips carry textual meaning

Priority 3:
- Improve table semantics and sorting announcements
- Expand reduced-motion handling

## 17. Reporting and Traceability

Maintain:
- Accessibility issue register
- Route/component tags for each issue
- Time-to-fix metrics by severity

## 18. Definition of Done (Accessibility)

A release is accessible-ready when:
- No critical accessibility defects remain
- Core user journeys pass keyboard and screen reader checks
- Known issues are documented with owner and ETA
