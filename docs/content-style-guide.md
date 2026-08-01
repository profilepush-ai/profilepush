# ProfilePush Content and Microcopy Style Guide

Version: 1.0
Date: 2026-08-01
Status: Detailed baseline

## 1. Purpose

This guide standardizes user-facing language in Product UI, onboarding, notifications, and support-related surfaces.

Goals:
- Clear action-oriented copy
- Consistent terminology
- Reduced cognitive load
- Higher user confidence in AI-assisted workflows

## 2. Voice and Tone

Primary voice attributes:
- Clear
- Direct
- Professional
- Supportive under stress

Tone adjustments by context:
- Success: concise and affirming
- Warning: calm and actionable
- Error: clear and non-blaming
- Empty state: motivating with one concrete next step

Avoid:
- Internal engineering jargon
- Vague generic messages
- Overly promotional copy in operational workflows

## 3. Language Principles

1. Start with user goal
2. Use verbs in action labels
3. Keep important nouns consistent
4. Prefer plain words over buzzwords
5. Tell the user what to do next

## 4. Product Terminology Glossary

Canonical terms:
- Bench
- Profile
- Job Finder
- Job Watch AI
- Submission Queue
- JD AI
- Resume AI
- Tracker
- Credits
- Match score
- Hotlist

Rules:
- Use exact module names in UI where navigation relies on name matching
- Avoid synonyms that create ambiguity

## 5. Control Labeling Standards

Button labels should:
- Begin with verb
- Be specific
- Avoid internal operation detail unless needed

Preferred patterns:
- Save profile
- Run match
- Add to queue
- Retry fetch
- Mark as submitted
- Upgrade plan

Avoid patterns:
- Submit (without object)
- Process now (without context)
- Continue (when multiple continues exist)

## 6. Form Microcopy Standards

## 6.1 Labels
- Required for all critical inputs
- Keep to 1-4 words where possible

## 6.2 Placeholders
- Show format or example
- Never replace labels

## 6.3 Helper text
- Explain constraints or side effects
- Keep under 120 characters when possible

## 6.4 Validation text
Pattern:
- Problem + action
Example:
- Enter a valid email address.
- Upload a PDF or DOCX file.

## 7. Empty State Copy Patterns

Pattern:
- Headline: what is absent
- Body: why this matters
- Action: immediate next step

Examples:
- No profiles yet
  Add your first candidate profile to start matching jobs.
  Action: Add profile

- No watch schedules
  Set a schedule to discover new jobs automatically.
  Action: Create schedule

## 8. Error Message Standards

Structure:
1. What failed
2. Why (if known and safe)
3. What user can do now

Severity-specific style:
- Blocking: explicit and direct
- Non-blocking: concise inline warning

Examples:
- Could not load job results. Check your filters and try again.
- Resume rewrite failed for this profile. Try again or continue without rewrite.

Do not include:
- raw stack traces
- internal IDs unless support flow needs them

## 9. Success Message Standards

Use when user completes meaningful action.

Examples:
- Profile saved.
- 12 jobs added to Submission Queue.
- Schedule updated.

Guidelines:
- Keep success messages short
- Avoid unnecessary punctuation and filler words

## 10. Warning and Confirmation Copy

Warnings should clarify impact.

Confirmation modal pattern:
- Title: action and object
- Body: irreversible consequence if any
- Primary CTA: explicit action
- Secondary CTA: cancel

Examples:
- Remove watch schedule?
- Deleting this schedule stops automatic matching for this scope.
- Primary: Remove schedule
- Secondary: Keep schedule

## 11. Notification Copy Templates

## 11.1 Informational
- Daily summary is ready.

## 11.2 Action-needed
- Credits are low. Top up to continue AI workflows.

## 11.3 Success event
- Job watch run completed with 8 new matches.

## 11.4 Failure event
- Job watch run failed. Open run details to retry.

Guidelines:
- Keep title under 60 characters
- Body under 120 characters where possible
- Include direct link target when action is required

## 12. AI-specific Copy Rules

Explain AI outputs without overclaiming.

Allowed framing:
- Suggested
- Estimated
- Match confidence
- Recommended

Avoid framing:
- Guaranteed
- Perfect match
- Final verdict

Rationale requirements:
- Provide brief reason for high/low score where available
- Offer manual override path

## 13. Date, Time, and Number Formatting

Recommended defaults:
- Date: YYYY-MM-DD in data tables, localized human format in summaries
- Time: include timezone where schedule/run timing matters
- Currency: use symbol + two decimals
- Percentages: whole number unless precision is critical

## 14. Inclusive and Accessible Language

Rules:
- Use neutral, respectful language
- Do not assume user expertise
- Do not use blame language in errors
- Avoid idioms that reduce clarity for global teams

## 15. Marketing Copy Alignment

Marketing pages may be more expressive, but must remain aligned with product truth.

Rules:
- Feature claims must match shipped behavior
- Avoid unsupported superlatives
- CTA labels map directly to real product actions

## 16. Content QA Checklist

Before release verify:
- Terminology consistency
- Grammar and spelling
- Error/help text actionability
- Character length fit across breakpoints
- Accessibility labels for icon-only actions

## 17. Governance and Ownership

Suggested ownership:
- Product marketing owns top-funnel pages
- Product/design owns in-app microcopy
- Engineering ensures implementation parity with approved strings

Change process:
- Record major wording changes in PR notes
- Update this guide for net-new patterns

## 18. Reusable Copy Library

Starter reusable strings:
- Saving changes...
- Changes saved.
- Unable to save changes. Try again.
- Loading results...
- No results found.
- Retry
- View details
- Dismiss

## 19. Localization Readiness Notes

Even if localization is not immediate:
- Avoid hardcoding string concatenation patterns
- Keep sentence structures translatable
- Separate variables from static text

## 20. Open Decisions

- Should product use title case or sentence case for major headings consistently?
- Should notification titles include module prefixes?
- Should AI confidence labels be standardized across all modules?
