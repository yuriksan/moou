---
title: Excel export cell validation
type: feat
status: research
date: 2026-04-06
---

# Excel export cell validation

Research-only design document for adding spreadsheet-side data validation to the
Excel export. Captures backend constraints, the JSON Schema landscape for
motivation custom attributes, what `exceljs` supports, the design questions that
need an answer before coding, an effort estimate, and the gotchas worth knowing.
**Not yet implemented.** Status will move to `approved` once the open questions
at the bottom are resolved.

## Goal

When a user opens an exported `.xlsx` from moou, every cell with a backend
constraint should be enforced inside Excel itself: dropdowns for enums, range
checks for numerics, date validation for dates, length caps on titles. This
includes per-motivation-type custom attributes. The backend stays the source of
truth (the import path already validates everything before applying), but the
spreadsheet gives users immediate feedback so they don't have to upload-and-fail
to discover bad input.

## Why it's tractable

All the pieces are already on disk:

- The constraints are formal — `api/src/lib/input-validation.ts` exports
  TypeScript constants like `VALID_OUTCOME_STATUSES`, `VALID_EFFORT_SIZES`,
  `VALID_MILESTONE_TYPES`, `VALID_MILESTONE_STATUSES`
- Motivation attribute schemas are JSON Schema 2020-12, stored in
  `motivation_types.attribute_schema` and seeded in `api/src/db/seed.ts`
- The export pipeline (`api/src/routes/export.ts`) already iterates rows
  column-by-column and applies cell-level styling — adding `cell.dataValidation`
  fits the same loop with no architectural change
- `exceljs` (already a dependency) has first-class support for the OOXML data
  validation types we need
- The import path (`api/src/routes/import.ts`) already validates enum fields
  and uses `additionalProperties: false` JSON Schema validation on attributes,
  so this is purely a UX/round-trip improvement, not a new safety boundary

The work is mostly mechanical mapping: "constraint type X → exceljs
`DataValidation` object Y", repeated across the columns we already know about.

## What constraints exist

### Top-level fields (already in `input-validation.ts`)

| Field | Constraint |
|---|---|
| `outcome.effort` | `XS, S, M, L, XL` (or null) |
| `outcome.status` | `draft, active, approved, deferred, completed, archived` |
| `outcome.title` | non-empty string, ≤ 500 chars |
| `outcome.description` | string, ≤ 50 000 chars |
| `motivation.status` | `active, resolved` (DB CHECK constraint) |
| `motivation.title` | non-empty string, ≤ 500 chars |
| `milestone.type` | `release, deadline, review` (or null) |
| `milestone.status` | `upcoming, active, completed` |
| `milestone.targetDate` | date, YYYY-MM-DD |
| `tag.name` | non-empty string, ≤ 100 chars |

### Per-motivation-type custom attributes (from `seed.ts`)

Each motivation type has its own JSON Schema. The shapes are heterogeneous —
this is the part that makes export validation interesting.

| Type | Attribute | Constraint |
|---|---|---|
| **Customer Demand** | `customer_name` | string |
|  | `segment` | enum: `enterprise, SMB, partner, internal` |
|  | `strategic_flag` | boolean |
|  | `revenue_at_risk` | number ≥ 0 |
|  | `revenue_opportunity` | number ≥ 0 |
|  | `deal_stage` | enum: `live, renewal, prospect` |
|  | `target_date` | date |
|  | `impact_type` | enum: `blocker, major, minor` |
|  | `confidence` | number 0–1 |
| **Compliance** | `regulation` | string |
|  | `mandate_deadline` | date |
|  | `penalty_severity` | enum: `critical, high, medium, low` |
|  | `legal_exposure` | number ≥ 0 |
|  | `confidence` | number 0–1 |
| **Tech Debt** | `incident_frequency` | number ≥ 0 |
|  | `performance_impact` | enum: `critical, high, medium, low` |
|  | `blast_radius` | enum: `platform-wide, service, component` |
|  | `support_hours_monthly` | number ≥ 0 |
|  | `architectural_risk` | enum: `critical, high, medium, low` |
| **Internal Mandate** | `stakeholder` | string |
|  | `mandate_type` | enum: `tooling, process, security, strategy` |
|  | `target_date` | date |
|  | `business_justification` | string |
|  | `priority_override` | enum: `critical, high, medium, low` |
| **Competitive Gap** | `competitor` | string |
|  | `gap_severity` | enum: `table-stakes, differentiator, nice-to-have` |
|  | `deals_lost` | number ≥ 0 |
|  | `market_segment` | string |
|  | `confidence` | number 0–1 |

These should be derived from the schemas at runtime, not hand-listed. See the
`jsonSchemaToExcelValidation` helper in the implementation sketch below.

## What `exceljs` supports

Per-cell `cell.dataValidation` accepts an object whose `type` field maps cleanly
onto our constraint kinds:

| `type` | What it validates | Use for |
|---|---|---|
| `'list'` + `formulae: ['"a,b,c"']` (literal) **or** `['=Lists!$A$1:$A$10']` (range) | Dropdown of allowed values | Every enum field |
| `'whole'` / `'decimal'` + `operator: 'greaterThanOrEqual'`, `formulae: [0]` | Numeric ranges | `revenue_at_risk`, `legal_exposure`, `incident_frequency`, etc. |
| `'decimal'` + `operator: 'between'`, `formulae: [0, 1]` | Bounded ranges | `confidence` |
| `'date'` + `operator: 'greaterThan'`, `formulae: [new Date(2000, 0, 1)]` | Valid dates | `target_date`, `mandate_deadline`, `milestone.targetDate` |
| `'textLength'` + `operator: 'lessThanOrEqual'` | Length caps | `title` (500), `description` (50 000) |
| `'custom'` + `formulae: ['=ISNUMBER(A1)']` | Anything else | Edge cases (e.g. tag-name lookup) |

Each rule also takes:

- `allowBlank: true` so empty cells are accepted (e.g. an outcome with no effort)
- `showErrorMessage: true` + `errorTitle` + `error` for the popup on bad input
- `showInputMessage: true` + `promptTitle` + `prompt` for the on-cell hint
- `errorStyle: 'stop' | 'warning' | 'information'` — `stop` blocks the value,
  `warning` lets the user override with a confirmation prompt

Everything we need is in the library that's already a dependency. No swap.

## How it slots into the current export

`api/src/routes/export.ts` already loops rows inside `for (let i = 0; i <
sheetRows.length; i++)`. After the existing `sheet.addRow(sanitized)` line, the
new code is roughly:

```ts
const excelRow = i + 2;

// Top-level enum columns — same for every row
sheet.getCell(`D${excelRow}`).dataValidation = effortValidation;          // Effort
sheet.getCell(`E${excelRow}`).dataValidation = outcomeStatusValidation;    // Status
sheet.getCell(`L${excelRow}`).dataValidation = motivationStatusValidation; // Motivation Status

// Per-attribute, only when this row's motivation is the right type
const typeName = row.motivationType;
if (typeName) {
  for (const attrKey of allAttrKeys) {
    const validation = lookupValidation(typeName, attrKey);
    if (validation) {
      const cell = sheet.getCell(`${attrColLetter(attrKey)}${excelRow}`);
      cell.dataValidation = validation;
    }
  }
}
```

Validation objects themselves are precomputed once before the loop and reused.
Roughly 5–6 enum rules + 10–12 numeric/date rules + 4 length rules — maybe
25 lines of constant declarations plus the `jsonSchemaToExcelValidation` helper.

## The interesting design question: per-row vs per-column validation

**This is the only non-trivial decision and it's worth thinking through *before*
writing code.**

The current export is a **right-joined sheet**: every row is a motivation joined
back to its parent outcome. The columns include the union of all attribute keys
across all motivation types. So row 5 might be a Customer Demand motivation
(with `revenue_at_risk` populated and `regulation` empty) and row 6 might be a
Compliance motivation (the opposite).

That means the **same column** holds different value spaces in different rows:

- Column `Q` (`attr_penalty_severity`) is `critical/high/medium/low` for
  Compliance rows but should be **blank** for Customer Demand rows
- Column `J` (`attr_segment`) is `enterprise/SMB/partner/internal` for Customer
  Demand rows but blank for everything else

Three options, in order of complexity:

### Option A — Per-cell validation **(recommended)**

For each row, look up the motivation type and apply only the validations
relevant to that type's attributes. Cells in attribute columns that don't apply
to this row's type get either:

- **No validation** (lets the user enter anything, including by mistake)
- **A "must be blank" rule** (`textLength = 0`) so users can't accidentally fill
  in the wrong column — recommended
- Validation that allows the union of all types' values (least useful, leaks types)

**Effort:** all the looping is already there, it's just adding `cell.dataValidation
= …` calls in the right branches.

### Option B — One sheet per motivation type

Restructure the export so each motivation type gets its own sheet, with only the
attribute columns relevant to that type. Then per-column validation is sufficient
— every row in `Customer Demand!H` is `confidence`, every row in `Compliance!E`
is `mandate_deadline`, etc.

**Pro:** much cleaner spreadsheet UX, validation is column-uniform, no "this
column means different things on different rows" gotcha.

**Con:** breaks the existing milestone-grouped layout (one sheet per milestone).
The export's whole point is "look at one sheet to see what's in Q3 Release", and
splitting by type undermines that. Out of scope for this work.

### Option C — Hybrid: keep milestone sheets, add a hidden `_Lists` sheet

Add a hidden `_Lists` sheet that holds named ranges for every enum
(`OutcomeStatuses`, `EffortSizes`, `CustomerDemand_Segments`, etc). Use those as
the validation source. This is the standard Excel pattern for spreadsheets that
ship with controlled vocabularies.

**Pro:** dropdowns survive cell copy-paste, the source is a single point of
truth, easier to maintain.

**Con:** another moving piece (`_Lists` sheet creation), and per-row
applicability logic still applies.

**Recommendation:** **Option A first**, with `_Lists` (Option C) as a v2 if the
literal-string approach turns out to be unwieldy. Literal `list` validations cap
out at ~255 chars of comma-separated values, which is fine for every enum here
(longest is ~40 chars).

## Round-trip implications

The import path already validates enum fields before applying them
(`api/src/routes/import.ts:244`, `validateField`). So adding spreadsheet-side
validation is purely a UX improvement: the backend stays the source of truth,
but the user gets immediate feedback in Excel rather than seeing
"SKIPPED: invalid effort value" after re-uploading.

There's a nice side effect: if the validation rules in the export are derived
from the same constants the import uses (`VALID_OUTCOME_STATUSES`, etc.), they
**cannot drift**. The work should `import` those constants directly into
`export.ts` rather than re-listing them.

For motivation attributes the **JSON Schema is the contract**. The Excel
validation must be derived from the schema, not duplicated. The implementation
should include:

- A small `jsonSchemaToExcelValidation(schema)` helper that walks
  `properties.<key>.{type, enum, minimum, maximum, format}` and returns an
  exceljs `DataValidation` object per key
- Called once per motivation type at export time, results memoized
- ~30–40 lines

This means **adding a new motivation type** (or changing an existing one's
schema) automatically gets the right validations in the next export, with no
separate maintenance.

## Specific risks and gotchas

### 1. Cell merging interacts with validation

The current export merges cells A–G across all motivation rows belonging to the
same outcome. Excel applies cell validation to *individual* cells, but merged
cells share a single value. The validation should be applied to the *first* row
of each merge range (the visible one), not all rows. Merging happens *after*
`addRow`, so this is fine — but worth a smoke test.

### 2. The 255-char literal-list limit

Any enum whose comma-joined string exceeds 255 characters won't fit as a literal
`formulae: ['"a,b,c"']`. None of the current enums come close
(`enterprise,SMB,partner,internal` is 32 chars). But if the tag column ever gets
the same treatment ("only allow existing tag names"), the literal list could
exceed the limit easily — that scenario needs the hidden-sheet approach
(Option C).

### 3. Booleans aren't a first-class validation type

`strategic_flag: boolean` doesn't have a built-in exceljs validation type. Use
`'list'` with `["TRUE","FALSE"]` (Excel native) or `["yes","no"]` (more
user-friendly but requires a re-mapping pass on import). The current export and
import already round-trip booleans as JS truthy strings, so either works.

### 4. Date format vs. Excel date cells

The JSON Schema says `format: 'date'` (i.e. `"2026-04-17"`). When the export
currently writes those values, exceljs treats them as strings, not Excel date
cells. If the implementation switches to `dataValidation: { type: 'date' }`,
Excel will reject string values that *look* like dates because the cell isn't
typed as a date. Two paths:

- **Convert** ISO date strings to JS `Date` objects before `addRow`, and let
  exceljs apply the date format. Cleaner, more invasive.
- **Use** `type: 'custom'` with `formulae: ['=ISNUMBER(DATEVALUE(A1))']`. Lower
  risk, slightly clunkier UX.

The first is cleaner; the second is lower risk. Recommended: the cleaner path
(convert to `Date`) since dates are already a small, well-bounded slice of the
attribute set.

### 5. Tag column is freetext today

Outcome tags are exported as `"security, compliance"` in column G. To enforce
"must be a known tag" you'd need a custom-formula validator referencing a hidden
tag list, or you'd accept that this is a freetext field. The same is true on
import — tags are matched by name, with unknown names creating new tags. **Leave
freetext** for v1.

### 6. Excel for the web vs. desktop Excel vs. Numbers vs. LibreOffice

Cell data validation is part of the .xlsx OOXML spec, but enforcement quality
varies:

| Tool | Enforcement |
|---|---|
| Desktop Excel (Mac/Windows) | Full ✓ |
| Excel for the web | Mostly ✓ (occasional differences with custom formulas) |
| Google Sheets (after import) | Strips most data validation rules ✗ |
| Apple Numbers | Strips most rules ✗ |
| LibreOffice Calc | Mostly ✓ |

Not a blocker. The import-side validation in `routes/import.ts` is the real
defence — Excel validation is the convenience layer.

## Effort estimate

| Piece | Estimate |
|---|---|
| Helper: build `DataValidation` objects for each top-level enum from existing constants | 20 min |
| Helper: `jsonSchemaToExcelValidation()` walking attribute schemas | 30–45 min |
| Wire validations into the export loop (per row, per applicable column) | 30 min |
| Date conversion (ISO string → JS `Date`) for date attributes | 20 min |
| "Must be blank" validation for non-applicable cells | 15 min |
| Tests: assert validation rules exist on the right cells; manual smoke test by actually opening the file in Excel | 30–60 min |
| Update `SPEC.md` and add an ADR | 15 min |

**Total: ~3 hours of focused work.**

## What *not* to do

- **Don't** duplicate the constants between `input-validation.ts` and
  `export.ts`. Import them.
- **Don't** generate validations from a hand-maintained list of attributes.
  Walk the schemas the seed already defines.
- **Don't** restructure the export to one-sheet-per-type just to make validation
  cleaner — the milestone grouping is more valuable than column purity.
- **Don't** ship a hidden `_Lists` sheet on the first pass. Literal lists are
  fine for what's there today; the hidden-sheet approach is a good v2 if/when
  the tag column gets validated.

## Open questions to settle before implementing

1. **Non-applicable attribute cells:** locked-blank (clear "this column doesn't
   apply to this row") or freetext (lets users repurpose them, with import-side
   validation as the safety net)?
2. **Dates:** value-pipeline conversion (cleaner Excel UX but touches more code)
   or custom-formula approach (one-line per cell, slightly clunkier UX)?
3. **Import behaviour for stray attribute values:** an exported-then-modified
   sheet that *adds* a value in an attribute column not native to that
   motivation type — silently dropped, flagged in the diff review, or rejected
   outright? The current import already drops unknown attribute keys via JSON
   Schema's `additionalProperties: false`. Excel validation would just make the
   problem visible to the user *before* re-upload.

None of these are blocking. They're 5 minutes of conversation before writing
the helper.

## Files that will change

- `api/src/routes/export.ts` — new helpers, validation calls inside the row loop
- `api/src/lib/input-validation.ts` — no changes; constants imported by export
- `api/src/__tests__/export-import.test.ts` — assertions that validation rules
  exist on the expected cells
- `docs/SPEC.md` — short note in the Export section about validated cells
- `docs/DECISIONS.md` — new ADR if "derive validations from JSON Schema, not a
  hand-maintained list" is worth recording (it is)

## Source files referenced during research

- `api/src/db/seed.ts` — motivation type schemas
- `api/src/db/schema.ts` — DB CHECK constraints
- `api/src/lib/input-validation.ts` — exported constants
- `api/src/lib/validate.ts` — Ajv validation flow
- `api/src/routes/export.ts` — current export pipeline
- `api/src/routes/import.ts` — round-trip validation that already exists
