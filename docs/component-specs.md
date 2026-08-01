# ProfilePush Component Specifications

Version: 1.0
Date: 2026-08-01
Status: Detailed baseline

## 1. Purpose

This document defines reusable component behavior, visual states, interaction contracts, and accessibility requirements for ProfilePush.

Goals:
- Consistent implementation across teams
- Predictable interaction behavior
- Reduced UI regressions in complex screens

## 2. Component Taxonomy

### 2.1 Structural components
- AppShell
- TopNav
- PageHeader
- ContentSection
- ContextPanel

### 2.2 Data display components
- DataTable
- CandidateCard
- StatCard
- Timeline
- Badge and Chip

### 2.3 Form components
- TextInput
- SelectInput
- MultiSelect
- LocationAutosuggestInput
- TextArea
- Toggle
- Checkbox
- RadioGroup
- DateRangePreset

### 2.4 Feedback and overlays
- Toast
- InlineAlert
- EmptyState
- LoadingState
- Modal
- Dropdown
- Tooltip

## 3. Global Component Rules

Every component must define and support:
- default
- hover
- active
- focus-visible
- disabled
- loading
- error

Every interactive component must include:
- keyboard path
- aria attributes
- deterministic focus behavior

## 4. AppNav Specification

Reference:
- src/components/AppNav.tsx

Responsibilities:
- Global module navigation
- Credit visibility
- Notifications entry and read flow
- Account menu actions

Behavior rules:
- Active route highlight must include nested paths
- Notification count updates on realtime inserts
- Dropdowns close on outside click and route transitions
- Menu actions are keyboard accessible

Accessibility:
- Icon-only buttons require aria-label
- Notification drawer must have role and heading
- Escape key should close open drawer/menu

## 5. ProtectedRoute Specification

Responsibilities:
- Gate authenticated pages
- Redirect unauthenticated users
- Preserve intended destination where safe

Rules:
- No flashing protected content before redirect
- Loading states should remain minimal and consistent

## 6. Toast Specification

Responsibilities:
- Show transient success, warning, and error feedback

API contract:
- type: success | warning | error | info
- title: short label
- message: optional supporting text
- durationMs: optional override
- onClose callback

Behavior:
- Auto-dismiss for non-critical messages
- Persistent mode for critical failures
- Queue support for rapid events

Accessibility:
- role=status for info and success
- role=alert for errors

## 7. LogoSpinner and LoadingState

Reference:
- src/components/LogoSpinner.tsx

Requirements:
- Use as route-level fallback
- Provide skeleton alternatives for large data surfaces
- Loading indicator must not cause layout jump

## 8. Form Control Specifications

## 8.1 TextInput

States:
- default
- focus
- invalid
- disabled

Rules:
- Label always visible
- Helper text optional
- Error text required when invalid
- Character count optional for constrained fields

## 8.2 SelectInput and MultiSelect

Rules:
- Placeholder only for unselected state
- Selected items visible as chips for multi-select
- Keyboard support for open, navigate, select, close

## 8.3 LocationAutosuggestInput

Reference:
- src/components/LocationAutosuggestInput.tsx

Rules:
- Debounced network requests
- Distinguish loading, no results, and API error
- Selection emits normalized location structure where available

## 8.4 DateRangePreset and filters

Rules:
- Presets should be explicit and mutually exclusive
- Include clear reset to default state
- Show active filter count in dense modules

## 9. Data Display Specifications

## 9.1 DataTable

Use cases:
- Bench records
- Job search and match results
- Submission queue records

Requirements:
- Sticky headers where practical
- Sort indicators
- Empty state with action CTA
- Row selection for batch actions

Interaction:
- Row click opens details
- Inline actions remain discoverable and non-destructive by default

## 9.2 CandidateCard

Use cases:
- Bench sidebars and shortlist displays

Required content:
- Candidate identity
- Role and location
- Stage/status chip
- Freshness and activity signals

Visual states:
- default
- selected
- hovered
- flagged

## 9.3 StatCard

Use cases:
- Desk KPIs
- Module summaries

Content model:
- Label
- Value
- Delta trend
- Optional sparkline or contextual hint

## 10. Status and Feedback Components

## 10.1 Badge and Chip

Types:
- stage
- source
- status
- credit level

Rules:
- Semantic color mapping only
- Never rely on color alone to convey meaning

## 10.2 InlineAlert

Use cases:
- Validation issues
- Permission issues
- Partial failure warnings

Pattern:
- Title
- Summary message
- Next action

## 10.3 EmptyState

Pattern:
- Primary statement
- One-line explanation
- Single primary CTA
- Optional secondary CTA

## 11. Overlay and Popup Components

## 11.1 Dropdown

Rules:
- Trigger retains focus after close
- Close on outside click and Escape
- Support keyboard navigation through options

## 11.2 Modal

Rules:
- Trap focus inside modal
- Close on Escape unless explicitly disabled
- Restore prior focus on close
- Distinct primary and secondary actions

## 11.3 Tooltip

Rules:
- Do not hide critical info exclusively in tooltip
- Delay appearance modestly
- Keyboard and screen reader equivalent needed

## 12. Notification Drawer Specification

Reference behavior:
- Global bell with unread count
- Grouped visual cues by notification category
- Mark read and mark all read actions

Requirements:
- Stable ordering by created_at descending
- Read state persistence
- Clear fallback when no notifications

## 13. ErrorBoundary Specification

Responsibilities:
- Prevent full app crashes from module exceptions
- Provide recoverable retry path
- Log useful context for diagnostics

UX pattern:
- Friendly error headline
- Short explanation
- Retry button
- Optional "go back" route

## 14. App Shell and Page Header Patterns

PageHeader composition:
- Title
- Context subtitle
- Quick actions
- Filter controls

Rules:
- Keep primary action on right in desktop
- Collapse secondary actions into menu in small widths

## 15. Domain-specific Pattern Specs

## 15.1 Parsing progress pattern

Use case:
- Resume parsing flow in Bench

Pattern:
- Multi-step list with active and completed states
- Do not fake completion on backend failure
- Keep user informed of the failing step

## 15.2 Match confidence pattern

Use case:
- Job match and shortlist screens

Pattern:
- Numeric confidence score
- Tier badge (high/medium/low)
- Expandable rationale

## 15.3 Credits status pattern

Use case:
- Global balance display and billing prompts

Pattern:
- Normal: success style
- Low: warning style
- Empty: danger style with direct billing CTA

## 16. Accessibility Matrix

Minimum per component:
- Keyboard interaction path documented
- Focus order verified
- Aria role and label verified
- Contrast verified
- Screen reader pass completed

## 17. QA Checklist per Component

Before merge:
- Visual state review completed
- Keyboard behavior verified
- Error and empty states tested
- Loading behavior tested under slow network
- Responsive behavior reviewed at core breakpoints

## 18. Component Ownership and Change Governance

Suggested ownership:
- Shared components: platform/front-end core
- Domain patterns: owning product module team

Change process:
- Update this spec when component behavior changes
- Link PRs to spec sections modified

## 19. Immediate Refactor Opportunities

High impact first:
- Extract shared FilterBar component
- Standardize ActionButton variants
- Standardize StatusChip primitive
- Introduce canonical EmptyState and LoadingState wrappers

## 20. Appendix: References

- src/components/AppNav.tsx
- src/components/Toast.tsx
- src/components/ProtectedRoute.tsx
- src/components/LocationAutosuggestInput.tsx
- src/pages/ProfilesDirectory.tsx
- src/App.tsx
