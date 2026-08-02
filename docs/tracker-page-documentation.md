# Tracker Page — Technical Documentation

> **File**: `src/pages/TrackerPage.tsx` (~1,025 lines)
> **Route**: `/tracker`
> **Purpose**: CRM-style vendor and client management with submission tracking, vendor history, and CSV export. Serves as the operational hub for managing staffing relationships and tracking revealed job leads.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Model](#data-model)
4. [Types & Interfaces](#types--interfaces)
5. [Constants](#constants)
6. [State Management](#state-management)
7. [Data Flow & Lifecycle](#data-flow--lifecycle)
8. [Core Functions](#core-functions)
9. [UI Layout & Components](#ui-layout--components)
10. [Feature Details](#feature-details)
11. [Database Tables Used](#database-tables-used)
12. [Dependencies](#dependencies)

---

## Overview

The Tracker page is a two-panel CRM for bench sales recruiters:

- **Left panel (Vendors Table)**: A sortable, searchable table of vendor companies with masked contact info, checkbox selection, and inline edit/delete actions.
- **Right panel (Revealed Jobs History)**: When a vendor is selected, shows the history of jobs where the user revealed contact details for that vendor's postings.

Vendors can be added manually or auto-populated from the Pulse page when a user reveals contact info on a social lead. The page also supports client management and submission tracking via modals.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          AppNav (top bar)                        │
├──────────────────────────────────────────────────────────────────┤
│  Search Bar  |  Date Range Picker  |  Results Count              │
├──────────────────────────────────────┬───────────────────────────┤
│                                      │                           │
│  Vendors Table Header                │  Revealed Jobs Header     │
│  [count badge] [Download] [+ Add]    │  [count] [vendor name]   │
├──────────────────────────────────────┤───────────────────────────┤
│                                      │                           │
│  ┌─ Table ──────────────────────┐    │  ┌─ Job Card ──────────┐  │
│  │ ☐ Name  Contact Email Phone  │    │  │ Job Title           │  │
│  │   Location Subs Added  ✏️🗑️ │    │  │ Company • Location  │  │
│  │                              │    │  │ [Platform]          │  │
│  │  Row 1 (clickable)          │    │  │ Poster • 3h ago     │  │
│  │  Row 2 (highlighted=active) │    │  └─────────────────────┘  │
│  │  Row 3                      │    │  ┌─ Job Card ──────────┐  │
│  │  ...                        │    │  │ ...                  │  │
│  └──────────────────────────────┘    │  └─────────────────────┘  │
│                                      │                           │
├──────────────────────────────────────┴───────────────────────────┤
│  Modals: Add/Edit Vendor | Add/Edit Client | Add/Edit Submission │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `vendors` | Staffing vendor companies (auto-synced from Pulse reveals) |
| `clients` | End client companies |
| `submissions` | Candidate submission records to vendors/clients |
| `profiles` | Candidate bench profiles (used for auto-fill in submission forms) |
| `pulse_lead_actions` | Tracks revealed/breakdown actions (used for vendor history) |
| `social_jobs` | Scraped job postings (joined for vendor history display) |

---

## Types & Interfaces

### `Vendor`
A staffing vendor company record.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID primary key |
| `name` | `string` | Company name |
| `contact_person` | `string` | Primary contact name |
| `email` | `string` | Contact email |
| `contact` | `string` | Phone number |
| `location` | `string` | Company location |
| `created_at` | `string` | ISO creation timestamp |

### `Client`
An end client company record.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID primary key |
| `name` | `string` | Company name |
| `contact_person` | `string` | Primary contact name |
| `email` | `string` | Contact email |
| `phone` | `string` | Phone number |
| `location` | `string` | Company location |
| `created_at` | `string` | ISO creation timestamp |

### `VendorHistoryJob`
A social job posting linked to a vendor via revealed actions.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Social job ID |
| `job_title` | `string` | Job title |
| `company_name` | `string` | Company name on the posting |
| `location` | `string` | Job location |
| `posted_by_name` | `string` | Poster's name |
| `platform` | `string` | Source platform (LinkedIn, Dice, etc.) |
| `created_at` | `string` | ISO timestamp when scraped |
| `extracted_role_normalized` | `string \| null` | Normalized role title |

### `Submission`
A candidate submission to a vendor or client.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | UUID primary key |
| `candidate_name` | `string` | Candidate being submitted |
| `skill_set` | `string` | Candidate skills |
| `vendor_name` | `string` | Target vendor |
| `vendor_email` | `string` | Vendor email |
| `vendor_contact` | `string` | Vendor phone |
| `client_name` | `string` | End client |
| `job_location` | `string` | Job location |
| `rate` | `string` | Pay rate |
| `submitted_by` | `string` | Recruiter who submitted |
| `submission_date` | `string` | Date of submission |
| `submission_type` | `string` | "Client", "Vendor", or "Candidate" |
| `created_at` | `string` | ISO creation timestamp |

### Other Types
- **`DatePreset`** — `'30d' | 'today' | '7d' | 'month' | 'custom'`
- **`ComboOption`** — `{ value: string; subtitle?: string }` for autocomplete
- **`ComboboxProps`** — Configuration for the Combobox component
- **`ModalType`** — `'vendor' | 'client' | 'submission' | null`

---

## Constants

### `DATE_PRESETS`
Array of date range filter options:

| ID | Label |
|----|-------|
| `30d` | Last 30 days |
| `today` | Today |
| `7d` | Last 7 days |
| `month` | This month |
| `custom` | Custom range |

### `SUBMISSION_TYPES`
`['Client', 'Vendor', 'Candidate']` — Types of submissions.

### `TYPE_BADGE`
CSS class mapping for submission type badges:

| Type | Badge Style |
|------|-------------|
| Client | Blue background, blue text |
| Vendor | Amber background, amber text |
| Candidate | Emerald background, emerald text |

### `inputCls`
Shared Tailwind CSS classes for all form input fields.

### Empty Form Objects
- `emptyVendor` — `{ name: '', contact_person: '', email: '', contact: '', location: '' }`
- `emptyClient` — `{ name: '', contact_person: '', email: '', phone: '', location: '' }`
- `emptySubmission` — All submission fields initialized to empty strings

---

## State Management

### Data State

| Variable | Type | Purpose |
|----------|------|---------|
| `vendors` | `Vendor[]` | All vendor records |
| `clients` | `Client[]` | All client records |
| `submissions` | `Submission[]` | All submission records |
| `profiles` | `Profile[]` | Candidate profiles for auto-fill |
| `loading` | `boolean` | Initial data loading state |

### Date Filtering

| Variable | Type | Purpose |
|----------|------|---------|
| `datePreset` | `DatePreset` | Selected date range preset |
| `dateRange` | `{ start, end }` | Computed ISO date range |
| `customStart` | `string` | Custom range start (YYYY-MM-DD) |
| `customEnd` | `string` | Custom range end (YYYY-MM-DD) |

### Search & Selection

| Variable | Type | Purpose |
|----------|------|---------|
| `globalSearch` | `string` | Global search query |
| `selVendor` | `Set<string>` | Selected vendor IDs (checkboxes) |
| `selClient` | `Set<string>` | Selected client IDs |
| `selSub` | `Set<string>` | Selected submission IDs |

### Modal & Forms

| Variable | Type | Purpose |
|----------|------|---------|
| `modal` | `ModalType` | Currently open modal |
| `editingId` | `string \| null` | ID of record being edited |
| `vendorForm` | `object` | Vendor form state |
| `clientForm` | `object` | Client form state |
| `subForm` | `object` | Submission form state |
| `duplicateWarning` | `Submission \| null` | Detected duplicate submission |

### Vendor History

| Variable | Type | Purpose |
|----------|------|---------|
| `activeVendorId` | `string \| null` | Currently selected vendor for history |
| `vendorHistory` | `VendorHistoryJob[]` | Revealed jobs for active vendor |
| `historyLoading` | `boolean` | History loading state |

### Privacy Controls

| Variable | Type | Purpose |
|----------|------|---------|
| `revealedFields` | `Set<string>` | Field keys toggled visible (e.g., `email-{vendorId}`) |
| `copiedField` | `string \| null` | Field key currently showing "copied" state |

---

## Data Flow & Lifecycle

### 1. Initial Load (`useEffect` on mount)

```
fetchAll()
  ├── supabase.from('vendors').select('*').order('created_at', desc)
  ├── supabase.from('clients').select('*').order('created_at', desc)
  ├── supabase.from('submissions').select('*').order('submission_date', desc)
  └── supabase.from('profiles').select('id, candidate_name, location, desired_salary_min, core_skills')
      └── All four queries run in parallel via Promise.all
```

### 2. Search & Filter Pipeline

```
User types in search bar
  └── globalSearch state updates
      └── filteredVendors = vendors.filter(v =>
            [name, email, contact, contact_person, location]
              .some(f => f.toLowerCase().includes(query))
          )
      └── filteredClients = similar filter
      └── filteredSubs = similar filter

User selects date preset
  └── dateRange recomputes via buildRange()
      └── filteredVendors = vendors.filter(v => inRange(v.created_at, start, end))
      └── (date filter applies ONLY when NOT searching)
```

### 3. Vendor History Flow

```
User clicks vendor row
  └── handleVendorRowClick(vendor)
      ├── Toggle: if already active → deselect
      └── Set activeVendorId + loadVendorHistory(vendor)
          ├── Query pulse_lead_actions WHERE action_type='revealed'
          │   └── Get all revealed lead_ids
          └── Query social_jobs WHERE id IN revealed_ids
              AND (posted_by_name ILIKE vendor.name
                   OR poster_email = vendor.email
                   OR posted_by_name ILIKE vendor.contact_person
                   OR company_name ILIKE vendor.name)
              └── Set vendorHistory
```

### 4. Vendor Auto-Population (from Pulse)

```
Pulse page: user reveals a lead
  └── saveVendorToTracker(lead)
      ├── Check existing vendor by email
      ├── If exists → update contact fields
      └── If new → insert new vendor record
          └── Vendor appears in Tracker automatically
```

### 5. Submission with Duplicate Detection

```
User submits a submission
  └── saveSubmission()
      ├── Check for duplicate: same candidate + vendor/client within 7 days
      │   ├── If found → show duplicateWarning modal
      │   └── If confirmed → saveSubmission(skipDuplicateCheck=true)
      └── Insert/update submission record
```

---

## Core Functions

### Date Handling

| Function | Signature | Purpose |
|----------|-----------|---------|
| `buildRange` | `(preset, cs?, ce?) → { start, end }` | Compute ISO date range from preset |
| `inRange` | `(iso, start, end) → boolean` | Check if date falls within range |
| `formatDate` | `(d) → string` | Format to MM/DD/YYYY |
| `fmtIso` | `(iso) → string` | Format ISO to MM/DD/YYYY |
| `formatAgo` | `(dateIso) → string` | Human-readable time ago |

### Modal & Form Management

| Function | Purpose |
|----------|---------|
| `openAddVendor()` | Reset form, open vendor modal in add mode |
| `openEditVendor(v)` | Pre-fill form with vendor data, open in edit mode |
| `openAddClient()` | Reset form, open client modal in add mode |
| `openEditClient(c)` | Pre-fill form with client data, open in edit mode |
| `openAddSubmission()` | Reset form, open submission modal in add mode |
| `openEditSubmission(s)` | Pre-fill form with submission data, open in edit mode |

### Auto-Fill Functions

| Function | Purpose |
|----------|---------|
| `handleSubCandidateSelect(name)` | When candidate selected in submission form, auto-fill location and rate from profiles |
| `handleSubVendorSelect(name)` | When vendor selected in submission form, auto-fill vendor email and contact |
| `handleVendorNameSelect(name, opt)` | In vendor modal, load existing vendor data or start new |

### CRUD Operations

| Function | Purpose |
|----------|---------|
| `saveVendor()` | Insert new or update existing vendor |
| `saveClient()` | Insert new or update existing client |
| `saveSubmission(skipDuplicateCheck?)` | Insert/update submission with optional duplicate check |
| `confirmDelete()` | Delete selected vendor, client, or submission |

### Selection & Interaction

| Function | Purpose |
|----------|---------|
| `toggleSel(set, id, setter)` | Toggle item in a selection Set |
| `toggleExpand(set, id, setter)` | Toggle item expansion state |
| `handleVendorRowClick(vendor)` | Select/deselect vendor for history panel |
| `loadVendorHistory(vendor)` | Fetch revealed jobs matching vendor |

### Export

| Function | Purpose |
|----------|---------|
| `downloadCsv(filename, headers, rows)` | Generate and download CSV file |
| `downloadSubs(ids)` | Export selected/all submissions |
| `downloadVendors(ids)` | Export selected/all vendors |
| `downloadClients(ids)` | Export selected/all clients |

---

## UI Layout & Components

### Global Toolbar
- **Search input**: Searches across all vendor/client/submission fields
- **Date range picker**: Dropdown with preset buttons (30d, Today, 7d, Month, Custom)
- **Custom range**: Start/end date inputs with Apply button
- **Results count**: Shows total matching records when searching

### Vendors Table (Left Panel — 2fr)

**Header**: Vendor count badge, download button (when selected), "+ Add" button

**Table Columns**:

| Column | Width | Content |
|--------|-------|---------|
| Checkbox | 32px | Select for bulk actions |
| Name | auto | Vendor company name (bold) |
| Contact Person | 120px max | Masked by default (`Joh•••`), eye toggle to reveal |
| Email | 160px max | Masked by default (`abc@•••`), eye toggle + copy button |
| Phone | 100px max | Masked by default (`123•••`), eye toggle to reveal |
| Location | 120px max | Plain text |
| Subs | center | Submission count badge |
| Added | nowrap | Creation date |
| Actions | 64px | Edit (pencil) + Delete (trash) buttons |

**Row Behavior**:
- Click row → select vendor and load history (right panel)
- Active vendor row highlighted with amber background
- Checkbox, edit, delete clicks use `stopPropagation` to avoid triggering row select
- Alternating row colors (white / gray)

### Revealed Jobs History (Right Panel — 1fr)

**Header**: "Revealed Jobs" title with History icon, count badge, active vendor name

**States**:
1. **No vendor selected**: Placeholder with "Select a vendor to view their revealed job history"
2. **Loading**: `LogoSpinner` centered
3. **No results**: "No revealed jobs" placeholder
4. **Has results**: Scrollable list of job cards

**Job Card Layout** (matches Pulse page match card style, without action buttons):
```
┌────────────────────────────────────────┐
│ Job Title                   [PLATFORM] │
│ Company • Location                     │
│ Poster Name  •  3h ago                 │
└────────────────────────────────────────┘
```

### Modals

#### Vendor Modal
- **Name field**: Combobox with existing vendor suggestions
- **Contact fields**: Grid of text inputs (contact person, email, phone, location)
- **Save/Cancel**: Buttons at bottom

#### Client Modal
- Same structure as vendor modal
- Fields: name, contact person, email, phone, location

#### Submission Modal
- **Type selector**: Client / Vendor / Candidate toggle
- **Candidate**: Combobox with profile suggestions (auto-fills location, rate)
- **Vendor**: Combobox with vendor suggestions (auto-fills email, contact)
- **Client**: Combobox with client suggestions
- **Job details**: Location, rate, skill set, submitted by
- **Date**: Date picker for submission date
- **Duplicate warning**: Yellow alert box when potential duplicate detected

#### Delete Confirmation Modal
- Confirms deletion with record type and warning message
- Red "Delete" and gray "Cancel" buttons

---

## Feature Details

### Contact Privacy Masking
All sensitive contact fields are masked by default in the vendor table:

| Field | Masked Display | Revealed Display |
|-------|---------------|-----------------|
| Contact Person | `Joh•••` (first 3 chars) | Full name |
| Email | `abc@•••` (first 3 chars + @) | Full email as mailto link |
| Phone | `123•••` (first 3 chars) | Full phone number |

- Each field has an **Eye/EyeOff** toggle button
- State tracked in `revealedFields` Set using keys like `email-{vendorId}`, `phone-{vendorId}`, `cp-{vendorId}`
- State resets on page reload (no persistence)

### Email Copy Button
- Copy icon button next to email field
- Copies full email to clipboard regardless of mask state
- Shows green checkmark for 1.5 seconds after copying
- Uses `navigator.clipboard.writeText()`

### Vendor History
- Clicking a vendor row loads their revealed job history
- Queries `pulse_lead_actions` for all `action_type='revealed'` lead IDs
- Cross-references `social_jobs` matching the vendor by:
  - `posted_by_name` ILIKE vendor name
  - `poster_email` equals vendor email
  - `posted_by_name` ILIKE contact person
  - `company_name` ILIKE vendor name
- Results displayed as match-style cards (same design as Pulse feed cards)
- Clicking the same vendor again deselects and clears history

### Submission Duplicate Detection
Before saving a submission, the system checks for existing submissions with:
- Same `candidate_name` (case-insensitive)
- Same `vendor_name` or `client_name`
- Within the last 7 days

If a potential duplicate is found, a yellow warning appears with details of the existing submission. The user can choose to proceed or cancel.

### Combobox Component
A reusable autocomplete input used throughout the modals:
- Text input with dropdown suggestions
- Shows **Recent** section (most recently used options)
- Shows **All** section (filtered by query)
- Keyboard support (arrow keys, Enter, Escape)
- Click-outside detection to close
- Auto-selects on match

### CSV Export
- Available for vendors, clients, and submissions
- Export selected rows (via checkboxes) or all rows
- Downloads as `.csv` file with proper headers
- Columns match the table display

### Auto-Fill from Bench Profiles
When creating a submission:
- Selecting a **candidate** auto-fills their location and desired salary from the bench profile
- Selecting a **vendor** auto-fills their email and phone from the vendor record

### Date Range Filtering
- Applies to `created_at` / `submission_date` fields
- **Disabled during search** (search shows all-time results)
- Preset options: Last 30 days (default), Today, Last 7 days, This month, Custom
- Custom range allows start/end date pickers

---

## Database Tables Used

| Table | Operations | Purpose |
|-------|-----------|---------|
| `vendors` | SELECT, INSERT, UPDATE, DELETE | Vendor company records |
| `clients` | SELECT, INSERT, UPDATE, DELETE | Client company records |
| `submissions` | SELECT, INSERT, UPDATE, DELETE | Candidate submission tracking |
| `profiles` | SELECT | Auto-fill candidate data in submission forms |
| `pulse_lead_actions` | SELECT | Get revealed lead IDs for vendor history |
| `social_jobs` | SELECT | Job details for vendor history display |

### Row-Level Security
All tables use RLS policies scoped to the user's account via `account_members`:
- Users can only see/modify records belonging to their active account
- Enforced at the database level, not application level

---

## Dependencies

| Dependency | Usage |
|------------|-------|
| `react` | Core hooks: useState, useEffect, useCallback, useRef |
| `lucide-react` | 28 icons (Plus, Search, Trash2, Pencil, Eye, EyeOff, Copy, Check, History, etc.) |
| `AppNav` | Top navigation bar |
| `Toast` | Success/error notification toasts |
| `LogoSpinner` | Loading spinner for history panel |
| `useAuth` | Authentication context (user, account) |
| `supabase` | Supabase client for all DB operations |
| `Profile` type | From `types/database.ts` for bench profile data |
