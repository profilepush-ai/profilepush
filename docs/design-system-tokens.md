# ProfilePush Design System Tokens

Version: 1.0
Date: 2026-08-01
Status: Draft baseline for implementation

## 1. Purpose

This document defines the design token system for ProfilePush. Tokens create consistent visual behavior across modules and reduce drift across engineering contributions.

Token priorities:
- Semantic over raw values
- Reusable scales
- Accessibility-first contrast
- Stable naming for long-term maintenance

## 2. Token Naming Convention

Format:
- category.role.state

Examples:
- color.surface.default
- color.text.muted
- color.action.primary.hover
- space.4
- radius.md
- shadow.panel

Naming rules:
- Never use component-specific names in core tokens
- Never encode raw color names in semantic tokens
- Add state suffix only when behavior changes

## 3. Color Tokens

## 3.1 Brand and action palette

```yaml
color.brand.50:  '#eff6ff'
color.brand.100: '#dbeafe'
color.brand.200: '#bfdbfe'
color.brand.300: '#93c5fd'
color.brand.400: '#60a5fa'
color.brand.500: '#3b82f6'
color.brand.600: '#2563eb'
color.brand.700: '#1d4ed8'
color.brand.800: '#1e40af'
color.brand.900: '#1e3a8a'
```

## 3.2 Neutral palette

```yaml
color.neutral.0:   '#ffffff'
color.neutral.25:  '#fcfcfd'
color.neutral.50:  '#f8fafc'
color.neutral.100: '#f1f5f9'
color.neutral.200: '#e2e8f0'
color.neutral.300: '#cbd5e1'
color.neutral.400: '#94a3b8'
color.neutral.500: '#64748b'
color.neutral.600: '#475569'
color.neutral.700: '#334155'
color.neutral.800: '#1e293b'
color.neutral.900: '#0f172a'
```

## 3.3 Feedback palette

```yaml
color.success.50:  '#ecfdf5'
color.success.100: '#d1fae5'
color.success.500: '#10b981'
color.success.700: '#047857'

color.warning.50:  '#fffbeb'
color.warning.100: '#fef3c7'
color.warning.500: '#f59e0b'
color.warning.700: '#b45309'

color.danger.50:   '#fef2f2'
color.danger.100:  '#fee2e2'
color.danger.500:  '#ef4444'
color.danger.700:  '#b91c1c'

color.info.50:     '#eff6ff'
color.info.100:    '#dbeafe'
color.info.500:    '#3b82f6'
color.info.700:    '#1d4ed8'
```

## 3.4 Semantic color mapping

```yaml
color.surface.default:        '{color.neutral.0}'
color.surface.subtle:         '{color.neutral.50}'
color.surface.raised:         '{color.neutral.0}'
color.surface.overlay:        'rgba(15,23,42,0.45)'

color.border.default:         '{color.neutral.200}'
color.border.muted:           '{color.neutral.100}'
color.border.strong:          '{color.neutral.300}'
color.border.focus:           '{color.brand.500}'

color.text.default:           '{color.neutral.900}'
color.text.secondary:         '{color.neutral.700}'
color.text.muted:             '{color.neutral.500}'
color.text.inverse:           '{color.neutral.0}'
color.text.disabled:          '{color.neutral.400}'

color.action.primary.bg:      '{color.brand.600}'
color.action.primary.hover:   '{color.brand.700}'
color.action.primary.active:  '{color.brand.800}'
color.action.primary.text:    '{color.neutral.0}'

color.action.secondary.bg:    '{color.neutral.100}'
color.action.secondary.hover: '{color.neutral.200}'
color.action.secondary.text:  '{color.neutral.800}'

color.state.success.bg:       '{color.success.50}'
color.state.success.text:     '{color.success.700}'
color.state.success.border:   '{color.success.100}'

color.state.warning.bg:       '{color.warning.50}'
color.state.warning.text:     '{color.warning.700}'
color.state.warning.border:   '{color.warning.100}'

color.state.danger.bg:        '{color.danger.50}'
color.state.danger.text:      '{color.danger.700}'
color.state.danger.border:    '{color.danger.100}'

color.state.info.bg:          '{color.info.50}'
color.state.info.text:        '{color.info.700}'
color.state.info.border:      '{color.info.100}'
```

## 3.5 Contrast rules

Minimum contrast targets:
- Body text: 4.5:1
- Large text (>= 18pt regular or 14pt bold): 3:1
- Icon-only controls: 3:1 against adjacent surface
- Focus indicator: 3:1 against surrounding colors

## 4. Typography Tokens

## 4.1 Font families

```yaml
font.family.sans: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif'
font.family.mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
```

## 4.2 Type scale

```yaml
font.size.xs:  '12px'
font.size.sm:  '13px'
font.size.md:  '14px'
font.size.lg:  '16px'
font.size.xl:  '18px'
font.size.2xl: '20px'
font.size.3xl: '24px'
font.size.4xl: '30px'

font.line.xs:  '16px'
font.line.sm:  '18px'
font.line.md:  '20px'
font.line.lg:  '24px'
font.line.xl:  '28px'
font.line.2xl: '30px'
font.line.3xl: '34px'

font.weight.regular: 400
font.weight.medium:  500
font.weight.semibold: 600
font.weight.bold: 700
```

## 4.3 Text roles

```yaml
text.role.display: {size: '{font.size.4xl}', line: '{font.line.3xl}', weight: '{font.weight.bold}'}
text.role.h1:      {size: '{font.size.3xl}', line: '{font.line.2xl}', weight: '{font.weight.semibold}'}
text.role.h2:      {size: '{font.size.2xl}', line: '{font.line.xl}',  weight: '{font.weight.semibold}'}
text.role.h3:      {size: '{font.size.xl}',  line: '{font.line.lg}',  weight: '{font.weight.semibold}'}
text.role.body:    {size: '{font.size.md}',  line: '{font.line.md}',  weight: '{font.weight.regular}'}
text.role.caption: {size: '{font.size.xs}',  line: '{font.line.xs}',  weight: '{font.weight.medium}'}
```

## 5. Spacing Tokens

Use 4px base grid.

```yaml
space.0:  '0px'
space.1:  '4px'
space.2:  '8px'
space.3:  '12px'
space.4:  '16px'
space.5:  '20px'
space.6:  '24px'
space.8:  '32px'
space.10: '40px'
space.12: '48px'
space.16: '64px'
```

Guidelines:
- Dense controls in data modules use space.2 or space.3
- Form blocks use space.4 to space.6
- Major page sections use space.8+

## 6. Sizing Tokens

```yaml
size.control.xs: '28px'
size.control.sm: '32px'
size.control.md: '36px'
size.control.lg: '40px'

size.icon.xs: '12px'
size.icon.sm: '14px'
size.icon.md: '16px'
size.icon.lg: '20px'

size.sidebar.compact: '240px'
size.panel.context: '320px'
size.modal.md: '560px'
size.modal.lg: '760px'
```

## 7. Radius Tokens

```yaml
radius.none: '0px'
radius.xs: '4px'
radius.sm: '6px'
radius.md: '8px'
radius.lg: '12px'
radius.xl: '16px'
radius.2xl: '20px'
radius.full: '9999px'
```

## 8. Shadow Tokens

```yaml
shadow.xs:    '0 1px 2px rgba(15, 23, 42, 0.06)'
shadow.sm:    '0 2px 8px rgba(15, 23, 42, 0.08)'
shadow.md:    '0 8px 20px rgba(15, 23, 42, 0.10)'
shadow.lg:    '0 16px 36px rgba(15, 23, 42, 0.14)'
shadow.focus: '0 0 0 3px rgba(59, 130, 246, 0.35)'
```

## 9. Motion Tokens

```yaml
motion.duration.fast:   '120ms'
motion.duration.normal: '180ms'
motion.duration.slow:   '260ms'

motion.easing.standard: 'cubic-bezier(0.2, 0, 0, 1)'
motion.easing.emphasis: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
motion.easing.exit:     'cubic-bezier(0.4, 0, 1, 1)'
```

Usage rules:
- Hover effects: fast + standard
- Dropdowns and toasts: normal + standard
- Modal entrances: slow + emphasis

## 10. Z-index Tokens

```yaml
z.base: 0
z.sticky: 10
z.header: 20
z.dropdown: 30
z.popover: 40
z.modal: 50
z.toast: 60
z.overlay: 70
```

## 11. Token to Tailwind Mapping Strategy

Option A (short term): utility convention guide
- Define approved utility combinations for each semantic role

Option B (mid term): CSS variable layer
- Generate CSS custom properties from token source
- Tailwind config references semantic variables

Recommended phased implementation:
1. Freeze semantic names now
2. Create variables in a central CSS file
3. Refactor high-traffic components first

## 12. Governance and Change Process

- Changes require design + engineering approval
- Deprecated tokens remain for one release cycle
- No direct raw color introduction in component PRs without explicit exception

Checklist for token changes:
- Accessibility impact evaluated
- Theming impact evaluated
- Migration path documented
- Affected components listed

## 13. Initial Adoption Backlog

Priority 1:
- Header/nav
- Buttons
- Form controls
- Toasts
- Card and panel wrappers

Priority 2:
- Tables
- Notification drawer
- Modal patterns

Priority 3:
- Marketing section variants
- Advanced visual states

## 14. Open Questions

- Should ProfilePush support explicit dark mode in authenticated modules?
- Should compact/comfortable density become a user preference?
- Should brand accents differ between marketing and app shell?
