# Excel Export Restructure + Validation

**Status:** Plan  
**Date:** 2026-04-17  
**Supersedes:** `2026-04-06-excel-export-validation-design.md` (incorporates its validation work)

## Problem

The current export creates one sheet per milestone + a Backlog sheet. This causes:

1. **Stale sheets** — changing an outcome's milestone leaves it on the wrong sheet
2. **No overview** — you can't see everything at once or sort/filter across milestones
3. **Attribute sprawl** — every sheet has columns for all motivation types, most cells blank
4. **No summary data** — milestone-level aggregates aren't surfaced
5. **No data validation** — users can enter invalid values with no feedback until re-import

## New Sheet Structure

### Sheet 1: "Milestones" (reference + summary)

| Column | Notes |
|---|---|
| Milestone ID | Visible, narrow — used by import |
| Name | Editable — single source of truth |
| Target Date | Editable — single source of truth |
| Type | Dropdown: release, deadline, review |
| Status | Dropdown: upcoming, active, completed |
| Outcomes | Pre-computed count |
| Avg Priority Score | Pre-computed average |
| Completed | Pre-computed count of outcomes with status=completed |

This is the **single source of truth** for milestone properties. On import, moou reads this sheet first, updates milestone records, then processes the Timeline sheet.

### Sheet 2: "Timeline" (all outcomes, flat)

| Column | Notes |
|---|---|
| Outcome ID | Visible, narrow — used by import |
| Outcome | Editable title |
| Description | Editable |
| Milestone | **Dropdown** validated against Milestones sheet Name column |
| Effort | Dropdown: XS, S, M, L, XL |
| Status | Dropdown: draft, active, approved, deferred, completed, archived |
| Priority Score | Read-only (calculated) |
| Tags | Comma-separated |
| Motivation Count | Count (read-only) |
| Top Motivation Type | The type of the highest-scoring linked motivation |
| Motivation Summary | **Cell comment/note** with all linked motivations (type, title, score) — visible on hover |

- **AutoFilter** enabled on all columns — users filter by milestone, status, effort, tags
- **Pre-sorted** by milestone target date (looked up from Milestones sheet), then priority score desc
- Backlog items have an empty Milestone cell, sort to the bottom
- **No merged cells** — one row per outcome (motivation detail lives on type-specific sheets)
- Frozen header row

### Sheets 3–N: One per motivation type (e.g. "Customer Demand", "Compliance", etc.)

Each sheet contains only motivations of that type, with only the columns relevant to that type's attributes. No sparse columns.

| Column | Notes |
|---|---|
| Motivation ID | Visible, narrow — used by import |
| Motivation | Editable title |
| Outcome | Parent outcome title (read-only context) |
| Outcome ID | Visible, narrow — used by import to verify linkage |
| Score | Read-only (calculated) |
| Status | Dropdown: active, resolved |
| *(type-specific attributes)* | One column per attribute from the type's JSON Schema, with appropriate validation (enum dropdowns, numeric ranges, date pickers, etc.) |

Benefits:
- Each sheet is self-contained — no blank attribute columns
- Column headers use the human-readable names from JSON Schema
- Validation is specific to the type (e.g. "Customer Demand" gets `segment` dropdown, "Compliance" gets `penalty_severity` dropdown)

## Data Validation Rules

Import constants from `input-validation.ts` — don't duplicate.

### Timeline sheet
| Field | Validation |
|---|---|
| Milestone | `list` from Milestones!Name column (named range) |
| Effort | `list`: XS, S, M, L, XL |
| Status | `list`: draft, active, approved, deferred, completed, archived |
| Outcome title | `textLength` ≤ 500 |
| Description | `textLength` ≤ 50,000 |

### Milestones sheet
| Field | Validation |
|---|---|
| Type | `list`: release, deadline, review |
| Status | `list`: upcoming, active, completed |
| Target Date | `date` validation |
| Name | `textLength` ≤ 200 |

### Motivation type sheets
Derive validation per-column from the type's `attributeSchema` (JSON Schema → ExcelJS):
- `enum` → `list` dropdown
- `minimum`/`maximum` → `whole` or `decimal` range
- `format: 'date'` → `date` validation, write as JS Date object
- `type: 'boolean'` → `list`: TRUE, FALSE
- `type: 'number'` with `minimum: 0, maximum: 1` → `decimal` between 0–1
- Motivation status → `list`: active, resolved

### Cell comments for motivation summary

On the Timeline sheet, each outcome row gets an Excel **cell comment** on the "Motivation Summary" column containing:

```
Customer Demand: "ACME renewal blocker" (score: 850)
Compliance: "GDPR data residency" (score: 720)
Tech Debt: "Legacy auth module" (score: 340)
```

This gives a hover-preview of all motivations without leaving the Timeline sheet.

## Import Changes

The import route needs updating to match the new structure:

1. **Read Milestones sheet first** — upsert milestones (create new ones, update name/date/type/status of existing)
2. **Read Timeline sheet** — one row per outcome, resolve milestone by name (looked up from step 1)
3. **Read motivation type sheets** — match by Motivation ID, diff attributes and status
4. **Deleted outcomes** — outcomes in DB but not on Timeline sheet (same logic as today)
5. **New outcomes** — rows with no Outcome ID but a title (same logic as today)

The import no longer infers milestone from sheet name — it reads the Milestone column on the Timeline sheet and resolves against the Milestones sheet.

## Implementation Steps

### Step 1: Restructure export (export.ts)
- Replace per-milestone sheet loop with single Timeline sheet
- Add Milestones reference sheet with summary formulas
- Add per-motivation-type sheets with type-specific columns
- Add AutoFilter to Timeline and all type sheets
- Add cell comments for motivation summary on Timeline
- Remove cell merging (no longer needed — one row per outcome)
- Add Milestone and Milestone Date columns to Timeline

### Step 2: Add data validation (export.ts)
- Add `jsonSchemaToExcelValidation()` helper to translate JSON Schema → ExcelJS validation
- Apply enum dropdowns to Timeline sheet (effort, status, milestone)
- Apply type-specific validation to motivation type sheets
- Apply validation to Milestones sheet (type, status, date)
- Named range for milestone names, used by Timeline milestone dropdown

### Step 3: Update import (import.ts)
- Parse Milestones sheet first, upsert milestone records
- Parse Timeline sheet — one row per outcome, resolve milestone from column not sheet name
- Parse motivation type sheets by name match to motivation_types
- Update DiffItem types to reflect new structure
- Reject old-format imports: if no "Milestones" sheet found, return 400 with message "This spreadsheet uses an older export format. Please re-export from moou."

### Step 4: Update tests (export-import.test.ts)
- Test new sheet structure (Milestones + Timeline + type sheets)
- Test validation rules are present on expected cells
- Test cell comments on Timeline sheet
- Test import reads Milestones sheet first
- Test round-trip with new format
- Test that old-format (per-milestone sheet) imports are rejected with a clear error

### Step 5: Update markdown export
- Adjust `buildExportData()` if its interface changes
- Markdown export doesn't need restructuring (already groups by milestone)

## Decisions

1. **ID columns** — visible (narrow), not hidden. Users can see them for reference.
2. **No backward compatibility** — import rejects old-format exports (per-milestone sheets). Enforce by requiring a "Milestones" sheet; if absent, return a clear error: "This spreadsheet uses an older format. Please re-export from moou."
3. **Milestone summaries** — pre-computed static values, not Excel formulas.
4. **Read-only cells** — lock computed columns (Priority Score, Motivation Count, Score) using ExcelJS cell protection. The sheet uses `sheetProtection` with `sheet: true` but all editable cells get `protection: { locked: false }`, so only computed cells are locked.
