---
title: "feat: Executive-grade PPTX roadmap deck"
type: feat
status: active
date: 2026-04-20
---

# Executive-Grade PPTX Roadmap Deck

## Overview

Transform the existing PPTX export from a data dump (tables on every slide) into a compelling executive presentation optimized for a mixed engineering + sales leadership audience. The main deck tells a story with charts and KPI visuals; detailed tables move to an appendix.

## Problem Statement

The current `/export/timeline/pptx` route generates a flat table-per-entity deck that:
- Has no narrative arc (organized by data type, not by business story)
- Every slide looks identical (table after table)
- Missing summary metrics, trends, and risk callouts
- No charts or visual hierarchy
- Not scannable at presentation speed

## Proposed Solution

Replace the existing PPTX route with a restructured deck using pptxgenjs charts, shapes, and visual hierarchy:

**Act 1: The Stakes** — KPI cards, portfolio doughnut chart
**Act 2: Revenue & Customers** — horizontal bar chart, top-3 customer detail
**Act 3: Delivery Timeline** — Gantt-style shape timeline, milestone deep dives
**Act 4: Risk & Engineering** — risk cards, tech debt bar chart
**Act 5: Decisions Needed** — trade-off slide for the room to act on
**Appendix** — current detailed tables preserved for reference

## Technical Approach

### File: `api/src/routes/export.ts`

All changes are in the existing `GET /timeline/pptx` handler (lines 715-1034). The `buildStructuredData()` function remains unchanged — it already provides all needed data.

### Phase 1: Compute Executive Metrics

Add a new `computeExecMetrics()` function that derives:

```typescript
interface ExecMetrics {
  totalRevenueAtRisk: number;         // sum of all Customer Demand revenue_at_risk
  totalRevenueOpportunity: number;    // sum of all Customer Demand revenue_opportunity  
  totalLegalExposure: number;         // sum of all Compliance legal_exposure
  outcomesTotal: number;
  outcomesCompleted: number;
  outcomesOnTrack: number;            // status in ['active', 'approved']
  complianceDeadlinesSoon: number;    // mandate_deadline within 30 days
  complianceOverdue: number;          // mandate_deadline < today
  techDebtIncidentsTotal: number;     // sum incident_frequency
  motivationsByType: Map<string, { count: number; totalScore: number }>;
}
```

Input: the existing `motivationsByType` and `outcomeRows` from `buildStructuredData()`.

### Phase 2: Slide Generation (replace existing route body)

#### Slide 1: Title
- Dark background (`BRAND.dark`)
- "Product Roadmap" + date + "moou"
- Same as current but with `LAYOUT_WIDE` (13.33" x 7.5")

#### Slide 2: Executive Summary (NEW)
- 4 KPI cards using `addShape('roundRect')` + `addText()` overlay
- Cards arranged in 2x2 grid:
  - **Revenue at Risk** — `formatCurrency(totalRevenueAtRisk)`, red-tinted card
  - **Outcomes On Track** — `${onTrackPct}%` with green/amber/red based on threshold
  - **Next Compliance Deadline** — countdown in days, purple-tinted card
  - **Backlog Size** — count of unassigned outcomes, neutral card

Layout math (LAYOUT_WIDE = 13.33" wide):
```
margin = 0.8"
gap = 0.4"
cardW = (13.33 - 2*margin - gap) / 2 = 5.57"
cardH = 2.5"
row1Y = 1.5"
row2Y = row1Y + cardH + gap = 4.4"
```

#### Slide 3: Portfolio Balance (NEW)
- Doughnut chart via `addChart('doughnut', data, opts)`
- Segments = motivation types (Customer Demand, Tech Debt, Compliance, Competitive Gap, Internal Mandate)
- Values = total score per type (represents where prioritization weight falls)
- Colors from BRAND palette per type
- `holeSize: 50`, `showPercent: true`
- Title: "Where Priority Weight Concentrates"

#### Slide 4: Section Divider — "Customer Impact"
- Existing `addSectionDivider()` with `BRAND.customerBg`

#### Slide 5: Top Customers by Revenue at Risk (NEW)
- Horizontal bar chart via `addChart('bar', data, { barDir: 'bar' })`
- Top 5 customers sorted by revenue_at_risk descending
- Labels = customer names, values = dollar amounts
- `chartColors` = gradient from dark accent to light
- `showValue: true` with currency format
- Subtitle: total revenue at risk across all customers

#### Slides 6-8: Top 3 Customer Detail (REFINED)
- Keep existing table format but only for top 3 customers by revenue
- Add segment/deal stage badges in subtitle
- Cap at 5 rows per customer table (top motivations by score)

#### Slide 9: Section Divider — "Delivery Timeline"

#### Slide 10: Timeline Overview (NEW — milestone markers)
- Milestones have only `targetDate` (no start date), so this is a **point-in-time marker chart**, not a true Gantt
- X axis: today → furthest future milestone date (with month markers via `addText`)
- Y axis: stacked milestones (only upcoming/active, filter out completed)
- Each milestone = fixed-width bar (1.5") positioned at its target date on the X axis
- Bar color = status: green (completed), amber (active), gray (upcoming)
- "Today" marker: red vertical line shape
- Cap at 8 milestones; if more, show "and N more in appendix" text
- If all milestones are in the past, show a simple list with completion dates instead of timeline axis

Construction:
```
timelineLeft = 2.5"   // space for labels
timelineRight = 12.5"
timelineWidth = 10.0"
barHeight = 0.5"
barGap = 0.2"
barW = 1.5"  // fixed width — milestones have no duration
```

For each milestone:
- Compute `markerX = timelineLeft + (daysUntilTarget / totalDaysRange) * timelineWidth - barW/2`
- Clamp to ensure bar stays within slide bounds
- Add `addShape('roundRect')` + `addText()` overlay for name + date (truncate name to 25 chars)

#### Slides 11-12: Milestone Deep Dive (REFINED)
- Only show next 2 upcoming/active milestones (not all)
- Table capped at top 5 outcomes by priorityScore
- Add progress stat: "X/Y outcomes completed" as subtitle
- Add completion percentage bar (shape)

#### Slide 13: Section Divider — "Risks & Engineering"

#### Slide 14: Top Risks Card Layout (NEW)
- 3-column card layout using `addShape('roundRect')` + `addText()`
- Card 1: **Compliance** — nearest deadline, days remaining, regulation name
- Card 2: **Tech Debt** — highest-scoring item, incident frequency, blast radius
- Card 3: **Competitive** — highest-severity gap, competitor name, deals lost
- Each card: colored top border (using a thin shape), icon-like emoji header, key metric large, context small

Layout:
```
cardW = 3.5"
cardH = 4.0"
gap = 0.5"
startX = (13.33 - 3*cardW - 2*gap) / 2 = 0.79"
```

#### Slide 15: Tech Debt Bar Chart (NEW — conditional)
- Only if techDebtMotivations.length > 2
- Horizontal bar chart sorted by score descending
- Labels = motivation titles (truncated to 30 chars)
- Show incident frequency as data label suffix

#### Slide 16: Needs Decision (NEW)
- Detect genuine trade-offs where items **compete for the same milestone or outcome**:
  1. **Compliance vs Delivery**: compliance motivation with `mandate_deadline` before its linked outcome's milestone `targetDate` — the regulation demands it sooner than planned
  2. **Overloaded Milestone**: milestone where `outcomeCount` is highest AND `completedCount/outcomeCount` is lowest — too much work, behind schedule
  3. **Unplanned High-Priority**: top-3 scoring motivations linked to outcomes with no milestone (backlog items with high urgency but no delivery plan)
- Format as bullet text with `addText()` using rich text array (bold headers, normal detail)
- Show 1-3 items (skip slide only if 0 conflicts detected; 1 is fine)
- Each item framed as: "**[Conflict]** — [context]. Recommend: [action]"

#### Appendix Section
- Section divider: "Appendix — Detailed Data"
- Move ALL existing per-entity table slides here (all customers, all milestones, all motivation types)
- Reuse existing table generation code unchanged

### Phase 3: Helper Functions

New utility functions to add:

```typescript
// KPI card builder
function addKpiCard(slide: any, opts: {
  x: number; y: number; w: number; h: number;
  bgColor: string; borderColor: string;
  label: string; value: string; sublabel?: string;
}): void

// Gantt bar builder  
function addTimelineBar(slide: any, opts: {
  x: number; y: number; w: number; h: number;
  color: string; label: string; sublabel?: string;
}): void

// Status color helper
function statusColor(status: string): string
// 'completed' → green, 'active' → amber, 'upcoming' → gray

// Truncate text for chart labels
function truncate(text: string, max: number): string
```

## Acceptance Criteria

### Functional
- [ ] Executive summary slide with 4 KPI cards (revenue at risk, on-track %, compliance deadline, backlog)
- [ ] Doughnut chart showing portfolio balance by motivation type (with % annotation for dominant type)
- [ ] Horizontal bar chart for top 5 customers by revenue at risk (or fewer if <5 exist)
- [ ] Customer detail slides limited to top 3 (skip if <1 customer exists)
- [ ] Timeline overview using milestone markers positioned by target date
- [ ] Milestone deep dives limited to next 2 upcoming/active, capped at 5 outcomes each
- [ ] Risk cards slide (3-column layout; omit column if no data for that type)
- [ ] Tech debt bar chart (only when >2 items exist)
- [ ] "Needs Decision" slide with 1-3 auto-detected conflicts (skip if 0)
- [ ] All existing detailed tables preserved in Appendix section
- [ ] `addSectionDivider` updated for LAYOUT_WIDE dimensions (w: 11.7 instead of 8.4)

### Edge Cases
- [ ] Empty database: deck contains Title + "No data yet" slide only
- [ ] All milestones in the past: timeline slide shows completed list instead of axis
- [ ] Missing attributes (e.g. no `revenue_at_risk`): KPI shows $0 with "(no data)" sublabel when >50% of items lack the field
- [ ] Fewer than 3 customers: show only as many detail slides as customers exist

### Testing
- [ ] New integration test: `GET /timeline/pptx` returns 200 with valid PPTX content-type
- [ ] New integration test: response buffer is parseable (non-zero length, valid ZIP header)
- [ ] Unit tests for `computeExecMetrics()` with known inputs (including all-zero edge case)
- [ ] Manual QA: deck opens correctly in PowerPoint, Keynote, and Google Slides

## Implementation Notes

- **No new dependencies** — pptxgenjs already has charts and shapes
- **No new routes** — replaces existing `/timeline/pptx` handler
- **No schema changes** — all data derives from existing `buildStructuredData()`
- **Slide count**: ~16 main slides + N appendix (vs current ~10-20 flat slides)
- **pptxgenjs limitation**: per-bar colors not supported in v4.0.1 — use `chartColors` array for bar charts, which applies colors sequentially
- **Shape text**: shapes don't contain text directly — overlay with `addText()` at same coordinates
- **Layout**: `LAYOUT_WIDE` = 13.33" × 7.5"
- **"On track" definition**: outcomes with `status` in `['active', 'approved']` (verify against `VALID_OUTCOME_STATUSES` at implementation time; fallback to just `'active'` if `'approved'` doesn't exist)
- **Backlog definition**: outcomes where `milestoneId === null`
- **Section divider colors**: Timeline → `BRAND.white`, Risks → `BRAND.techDebtBg`, Appendix → `BRAND.headerBg`
- **Doughnut chart colors by type**: Customer Demand → `4a90c4` (blue), Tech Debt → `c44a4a` (red), Compliance → `8a4ac4` (purple), Competitive Gap → `4ac48a` (green), Internal Mandate → `c4914a` (orange)

## Risk & Edge Cases

- **Empty data**: If no motivations/outcomes exist, show Title + "No data yet — add outcomes and motivations to generate your roadmap" slide
- **Long text overflow**: Truncate customer names (25 chars), outcome titles (30 chars), milestone names (25 chars) for all chart/shape labels
- **Too many milestones**: Cap timeline at 8 upcoming/active milestones; completed ones excluded from main deck
- **No detectable conflicts**: Skip "Needs Decision" slide entirely
- **Color accessibility**: Use shape + value label (not color alone) to convey status; avoid pure red/green distinction
- **All milestones past**: Timeline slide falls back to a completion summary list
- **Missing attributes**: `revenue_at_risk`, `legal_exposure`, `incident_frequency` may be null/undefined — default to 0 and track % populated for data-quality annotation
- **`addSectionDivider` dimensions**: Must update from `w: 8.4` to `w: 11.7` for LAYOUT_WIDE (13.33" - 2×0.8" margin)
- **Appendix table widths**: Existing `colW` arrays sum to ~10.6" which still fits LAYOUT_WIDE; keep as-is (small right margin is fine for reference tables)
- **`priorityScore` and `score` are strings**: Always coerce with `Number(x || 0)` before arithmetic

## Sources & References

- pptxgenjs v4.0.1 TypeScript definitions: `node_modules/pptxgenjs/types/index.d.ts`
- Current implementation: `api/src/routes/export.ts:681-1034`
- Data structures: `api/src/routes/export.ts:42-82` (OutcomeRow, MotivationRow, MilestoneRow)
- Motivation schemas: `api/src/db/seed.ts` (attribute definitions per type)
- BRAND palette: `api/src/routes/export.ts:684-696`
