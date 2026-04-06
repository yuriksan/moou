# Moou — Outcome-Based Prioritisation System

## Purpose

A lightweight, fluid system for managing outcomes and their motivations — enabling product management and engineering teams to collaboratively build, rank, and maintain a living roadmap.

Sits upstream of external execution systems (ValueEdge, GitHub Issues, Jira, etc.). Approved outcomes flow into Epics, Features, and Stories.

### Boundary with External Systems

Moou and external systems have distinct responsibilities:

| | Moou | External Systems (ValueEdge, Jira, GitHub Issues, etc.) |
|---|---|---|
| **Owns** | What and Why | Who and How |
| **Concepts** | Outcomes, Motivations, Milestones, Priority | Epics, Features, Stories, Sprints, Squads |
| **Users** | PMs, Engineering leads, Stakeholders | Engineers, Scrum masters, Delivery managers |
| **Decisions** | What should we build? In what order? By when? | How do we build it? Who's assigned? What's the status? |

Moou does **not** duplicate execution concerns — no squad assignment, no sprint planning, no delivery tracking. That's the external system's job. The link between the two is the external entity ID on an outcome, scoped by provider (e.g. ValueEdge, Jira, GitHub Issues).

---

## Core Principles

- **Low friction** — creating and modifying outcomes and motivations should feel instant
- **Transparent ranking** — priority is computed from motivation attributes, not gut feel
- **Collaborative** — real-time updates so teams see the same picture
- **Auditable** — full history of what changed, when, and by whom
- **Extensible** — new motivation types and scoring functions can be added over time

---

## Personas

### Sarah — Director of Engineering

**Role:** Leads a team of 40 engineers across 4 squads. Reports to the CTO. Responsible for delivery, technical health, and capacity planning.

**Goals in Moou:**
- Record engineering-driven outcomes (tech debt reduction, platform migrations, security hardening) so they're visible alongside product work
- Plan what engineering can realistically deliver against milestones — map outcomes to releases, balance effort across squads
- Justify engineering investment to leadership with concrete motivations (incidents, support hours, architectural risk) rather than vague "tech debt" arguments
- See the full picture: what product is asking for, what engineering needs, and where they overlap

**Key workflows:**
- Creates outcomes for engineering initiatives, attaches Tech Debt and Internal Mandate motivations
- Reviews the Timeline view to assess milestone feasibility — are we overcommitting on Q3?
- Uses effort estimates to flag capacity issues — three XL outcomes in one milestone is a red flag
- Adds engineering motivations to PM-created outcomes (e.g. "this customer feature also addresses an architectural risk we've been tracking")

**Frustrations (what the system must avoid):**
- Having to use a product-centric tool that doesn't speak engineering language
- Engineering work being invisible or always losing to revenue-driven priorities
- Spending meeting time debating priority when data could settle it

---

### James — Senior Product Manager

**Role:** Owns the roadmap for the data platform product area. Works across 3 enterprise customers, reports to VP Product. Responsible for customer outcomes, revenue targets, and stakeholder communication.

**Goals in Moou:**
- Capture every customer demand, compliance requirement, and competitive gap with enough detail to justify prioritisation decisions
- Present a clear, defensible roadmap to executives — "here's what we're building, here's why, here's the evidence"
- Ensure nothing falls through the cracks — every customer conversation, every escalation, every competitive signal gets recorded as a motivation
- Collaborate with engineering on shared priorities — see engineering motivations on product outcomes so the full picture is visible

**Key workflows:**
- Creates outcomes for customer-facing features, attaches Customer Demand and Compliance motivations with revenue figures and dates
- Uses the Motivations view to audit coverage — "have we captured everything from the EMEA customer calls this week?"
- Filters by tags to prepare milestone-specific views for steering meetings
- Reviews the summary strip before leadership meetings — total outcomes, motivation breakdown, effort distribution
- Links outcomes to external system entities (ValueEdge, Jira, GitHub Issues) so engineering can trace back to "why"

**Frustrations (what the system must avoid):**
- Tools that require too much data entry to capture a quick insight
- Scoring systems that feel like black boxes — needs to explain to a VP why outcome A ranks above outcome B
- Stale data — if the system falls behind reality, people stop trusting it

---

## Entrypoints

Two teams feed the system:

### Product Management
Records outcomes driven by customer demand, revenue impact, market positioning, compliance requirements.

### Engineering
Records outcomes driven by technical debt, architectural risk, operational burden, security concerns.

Both teams can attach motivations to any outcome. The system doesn't enforce ownership boundaries — it captures the full picture.

---

# V1 — Core System

The goal of v1 is to prove the model works: outcomes, motivations, scoring, and the dual-navigation UI. Ship fast, learn, iterate.

---

## Domain Model (v1)

### Outcome

A desired result — a new feature, technical improvement, or architectural change.

#### Fields

- id
- title
- description (markdown — rendered as rich text, edited as plain markdown)
- effort (t-shirt size: XS | S | M | L | XL — optional, used in scoring)
- milestone_id (optional — links to a Milestone)
- status (draft | active | approved | deferred | completed | archived)
- pinned (boolean — manual override, pins to top of ranking with audit trail)
- tags[]
- created_by
- created_at
- updated_at

#### Derived Fields (computed from linked motivations)

- priority_score (aggregate of all linked motivation scores, adjusted by effort)
- earliest_critical_date
- motivation_count
- motivation_type_summary (e.g. "3 customer demand, 1 compliance, 1 tech debt")

#### External Links

- external_links[] — array of { provider: valueedge | github | jira | ..., entity_type: epic | feature | story | issue | ticket, entity_id, url, relationship: draft | connected | published, cached_details: { title, status, labels, assignee, milestone, progress, freshness_timestamp } }

Outcomes can be Draft (no backend link), Connected (linked to an existing backend item with cached details), or Published (moou created the backend item). Manual link entry remains available for providers without an adapter. No fragment mapping yet.

---

### Motivation

A first-class entity representing a reason to pursue one or more outcomes. Motivations are **shared across outcomes** (many-to-many).

#### Core Fields (all motivation types)

- id
- type (references a MotivationType)
- title
- status (active | resolved) — resolved motivations are preserved in history but excluded from scoring
- notes (supporting context, evidence links)
- tags[]
- created_by
- created_at
- updated_at

#### Type-Specific Attributes

Defined by the MotivationType schema. Stored as JSONB.

#### Linked Outcomes

- outcome_ids[] — the outcomes this motivation supports

#### Human-Readable Summary (derived)

Each motivation generates a plain-English summary from its attributes for non-technical stakeholders. Examples:
- "£1.8M at risk, Acme Corp renewal in 15 days, high confidence" → 486 pts
- "GDPR Art. 44, £5M exposure, critical severity, deadline in 45 days" → 461 pts
- "12 incidents/month, platform-wide blast radius, 18h/mo support" → 356 pts

Displayed alongside the score in the UI so anyone can understand *why* the number is what it is.

---

### Tag

GitHub-style labels that can be applied to both outcomes and motivations.

#### Fields

- id
- name (unique, e.g. "Q3-2026", "payments", "platform", "urgent", "EMEA")
- emoji (optional — visual prefix, e.g. "🔒" for security, "💰" for revenue)
- colour (hex — background colour for the label chip)
- description (optional — explains when to use this tag)

#### Display

Tags render as coloured chips with optional emoji prefix: `🔒 security` `💰 EMEA` `🏗️ platform`.

Outcomes display two kinds of tags:
- **Own tags** — directly applied to the outcome
- **Inherited tags** — surfaced from linked motivations, visually distinguished (dimmed or with a link icon)

Filtering works across both own and inherited tags.

#### Inline Creation

Tags are created inline while tagging an outcome or motivation:
1. User types in the tag input — autocomplete suggests existing tags
2. If no match, user creates a new tag right there — small popover for name, emoji, colour
3. No separate admin page needed for day-to-day use

#### Tag Admin

Lightweight management view for tidying up:
- Rename, merge, or delete tags
- Update emoji, colour, description
- Usage counts — tags with zero usage flagged for cleanup

#### Conventions

Tags replace a fixed `product_area` field. Suggested prefix conventions:
- `area:masking`, `area:ingestion` — product areas
- `team:platform`, `team:data` — owning teams
- `release:Q3-2026` — release targets
- `region:EMEA`, `region:NA` — geographic scope
- Or flat tags — whatever works for the team

---

### Milestone

A time-based grouping for outcomes — a product release, an internal deadline, a board review, an audit date.

#### Fields

- id
- name (e.g. "Q3 2026 Release", "SOC2 Audit Deadline", "Board Review May")
- target_date (date)
- type (release | deadline | review — optional, for display)
- description (optional)
- tags[] (milestones can be tagged — e.g. `region:EMEA`, `team:platform`)
- status (upcoming | active | completed)
- created_by
- created_at

#### Derived Fields (per milestone)

- outcome_count
- effort_summary (tally of t-shirt sizes, e.g. "1×S, 2×M, 1×XL")
- motivation_type_breakdown (count by type)

#### Behaviour

- Outcomes have an optional `milestone_id` — assigning an outcome to a milestone is one click
- The Timeline view groups outcomes by milestone, with a "No milestone" backlog column
- Milestones are optional — the system works fine without them, scoring still ranks everything
- Multiple outcomes can share the same milestone
- Milestones with approaching dates are visually highlighted
- Milestone headers on the timeline show the effort summary — making overcommitment visible at a glance

---

### MotivationType (Schema Definition)

Defines a category of motivation, its attribute schema, and its scoring function.

In v1, types are **shipped as built-in configuration** — editable via config file or seed data, not a runtime admin UI. The data model supports runtime editing so the admin UI can be added in v2.

#### Fields

- id
- name (e.g. "Customer Demand", "Compliance", "Tech Debt")
- description
- attribute_schema — defines the fields for this type (name, data type, required flag, validation)
- scoring_formula — formula expression referencing the type's attributes
- created_at
- updated_at

---

### Built-in Motivation Types

#### Customer Demand

| Attribute | Type | Description |
|-----------|------|-------------|
| customer_name | string | Customer or account name |
| segment | enum | enterprise, SMB, partner, internal |
| strategic_flag | boolean | Strategic account |
| revenue_at_risk | number | Revenue at risk if undelivered (£) |
| revenue_opportunity | number | New revenue enabled (£) |
| deal_stage | enum | live, renewal, prospect |
| target_date | date | Customer's desired delivery date |
| impact_type | enum | blocker, major, minor |
| confidence | number | 0.0–1.0 |

**Scoring formula:**
```
(revenue_at_risk * date_urgency(target_date) * confidence)
+ (revenue_opportunity * strategic_weight(strategic_flag) * confidence)
```

#### Compliance / Regulatory

| Attribute | Type | Description |
|-----------|------|-------------|
| regulation | string | Regulation or standard name |
| mandate_deadline | date | Hard compliance deadline |
| penalty_severity | enum | critical, high, medium, low |
| legal_exposure | number | Estimated financial exposure (£) |
| confidence | number | 0.0–1.0 |

**Scoring formula:**
```
legal_exposure * date_urgency(mandate_deadline) * severity_weight(penalty_severity) * confidence
```

#### Tech Debt

| Attribute | Type | Description |
|-----------|------|-------------|
| incident_frequency | number | Incidents per month attributable to this |
| performance_impact | enum | critical, high, medium, low |
| blast_radius | enum | platform-wide, service, component |
| support_hours_monthly | number | Hours spent on support/workarounds |
| architectural_risk | enum | critical, high, medium, low |

**Scoring formula:**
```
(incident_frequency * blast_radius_weight(blast_radius))
+ (support_hours_monthly * 10)
+ severity_weight(performance_impact) * severity_weight(architectural_risk)
```

#### Internal Mandate

| Attribute | Type | Description |
|-----------|------|-------------|
| stakeholder | string | Who is mandating this |
| mandate_type | enum | tooling, process, security, strategy |
| target_date | date | Required completion date |
| business_justification | string | Why this is mandated |
| priority_override | enum | critical, high, medium, low |

**Scoring formula:**
```
override_weight(priority_override) * date_urgency(target_date)
```

#### Competitive Gap

| Attribute | Type | Description |
|-----------|------|-------------|
| competitor | string | Competitor name |
| gap_severity | enum | table-stakes, differentiator, nice-to-have |
| deals_lost | number | Known deals lost to this gap |
| market_segment | string | Affected segment |
| confidence | number | 0.0–1.0 |

**Scoring formula:**
```
deals_lost * gap_weight(gap_severity) * confidence
```

---

## Scoring System (v1)

### Built-in Functions

| Function | Description |
|----------|-------------|
| `date_urgency(date)` | Returns a weight that increases as the date approaches. >90 days = 0.2, 30-90 = 0.5, 7-30 = 0.8, <7 = 1.0, overdue = 1.2 |
| `severity_weight(enum)` | Maps severity enums to numeric weights. critical=1.0, high=0.7, medium=0.4, low=0.1 |
| `strategic_weight(bool)` | Strategic accounts get higher weight. true=1.5, false=1.0 |
| `override_weight(enum)` | Maps priority overrides to weights |
| `blast_radius_weight(enum)` | Maps blast radius to weights |
| `gap_weight(enum)` | Maps competitive gap severity to weights |

### Date-Based Recalculation

Motivations with date attributes are recalculated by a **daily background job**. As deadlines approach, urgency increases automatically.

In v1, recalculation is batch (daily cron). No SSE push — users refresh to see updated scores.

### Outcome Priority Score

```
outcome.priority_score = SUM(motivation.score for each linked motivation) - effort_penalty(effort)
```

Where `effort_penalty` maps t-shirt sizes to a cost deduction:
- XS = 0, S = 50, M = 150, L = 300, XL = 500

This ensures high-value low-effort outcomes rank above high-value high-effort ones.

### Currency Scaling

Scoring formulas use the `k()` function to scale currency values by dividing by 1000. Users enter real values (£1,800,000) but the formula computes with `k(revenue_at_risk)` = 1800. This keeps scores in the hundreds/low thousands instead of millions — readable without normalization.

Example: `(k(revenue_at_risk) * date_urgency(target_date) * confidence)` with £1.8M at risk, 15 days out, 0.9 confidence = `1800 * 1.0 * 0.9` = **1,620**

The `k()` function is a built-in scoring function available in all formulas. Non-currency fields (incident counts, deal counts, hours) are not scaled.

### Pinning (Manual Override)

Outcomes can be **pinned** to the top of the ranking regardless of score. Pinning:
- Is visible in the UI (pin icon, distinct styling)
- Records who pinned it and when (audit trail)
- Shows the computed score alongside so the override is transparent
- Can be removed by anyone (also audited)

This handles "the CEO says we're doing this" without undermining the scoring system.

---

## Error Surfacing (v1)

Every API request made through the frontend `useApi` composable flows through a single `request()` wrapper that handles error display. When a call fails, a toast notification appears in the top-right corner of the app — users never have to open the browser console to discover that something went wrong.

The wrapper recognises four error classes and tailors the toast accordingly:

- **Network errors** — `fetch()` itself rejects (API not running, DNS failure, CORS block). Shown as *"Could not reach the server. Is the API running?"* with title *Network error*.
- **Non-JSON responses** — server returned HTML (e.g. Express's default 404 page) or any other content-type. Shown with a hint that the API may be running stale code and the dev server should be restarted. This specifically catches the class of bug where the watcher isn't running and new routes are missing.
- **HTTP errors with a JSON error envelope** — the server's `{ error: { code, message } }` is rendered as the toast body. The title varies by status (`Not signed in` for 401, `Forbidden` for 403, `Server error` for 5xx, `Request failed` otherwise).
- **Malformed JSON** — content-type is `application/json` but the body fails to parse. Shown as *"Server returned malformed JSON"*.

Callers that legitimately expect failures (e.g. `api.getMe()` on initial app load, which 401s for unauthenticated users) pass `silent: true` to suppress the toast while still receiving the rejected promise.

Toasts are global, deduplicated (identical back-to-back messages reset the existing timer rather than stacking), and auto-dismiss after a variant-specific timeout (3.5s success, 4s info, 7s error). Users can dismiss manually via a close button.

---

## Audit History (v1)

All changes are tracked:

- **What** changed (field-level diff)
- **Who** made the change (user)
- **When** it happened (timestamp)

Applies to: outcomes, motivations, links, external links, pins.

History is append-only. Displayed as most recent 3 entries with "show older" pagination.

---

## Authentication (v1)

- **GitHub OAuth** is the first real authentication implementation, required for backend integration (API access to GitHub Issues)
- **Mock auth** continues for local development and testing — configurable mock users switchable in the UI
- Auth middleware with a clear interface for future SSO integration (Okta, ValueEdge, etc.)
- User identity captured in all audit records

---

## External System Integration (v1)

Outcomes have three relationship states with backend items:

- **Draft** — moou-only, no backend representation. The default state.
- **Connected** — linked to an existing backend item (e.g. an issue that already exists in GitHub). Moou caches details from the backend and displays them alongside the outcome.
- **Published** — moou creates a new backend item (e.g. creates a GitHub Issue from the outcome). The outcome is then linked to the newly created item.

### Provider Adapter Interface

Backend providers implement a common adapter interface:

| Method | Description |
|--------|-------------|
| `searchItems(query, entityType)` | Search backend for items matching a query |
| `getItemDetails(entityId)` | Fetch full details for a specific item |
| `getChildProgress(entityId)` | Fetch progress of child items (e.g. sub-issues) |
| `createItem(entityType, payload)` | Create a new item in the backend |

### Cached Details

When an outcome is Connected or Published, moou caches details from the backend item:

- title
- status
- labels
- assignee
- milestone
- progress (from child items via `getChildProgress`)
- freshness_timestamp (when the cache was last refreshed)

Cached data is periodically refreshed using **ETag conditional requests** to minimise API usage. Stale data is visually indicated in the UI.

### API Endpoints

- GET /api/backend/search — search the backend for items to connect
- GET /api/backend/entity-types — list available entity types for a provider
- POST /api/outcomes/:id/connect — connect an outcome to an existing backend item
- POST /api/outcomes/:id/publish — create a new backend item from an outcome
- POST /api/external-links/:id/refresh — force-refresh cached details for a link

### Publish Flow

The "Publish" action is only offered for outcomes in the implicit **Draft** state — i.e. those with no external links. Once an outcome is connected or published, the publish affordance is hidden; further linking is done via Connect.

When publishing:

- The user picks an entity type if the provider exposes more than one creatable type. Types that cannot be created from a title + description alone (e.g. GitHub pull requests, which require head/base branches) are filtered out of the picker. If only one type is available, no dropdown is shown.
- A confirmation dialog identifies the target system and entity type by name (e.g. "This will create a new GitHub issue").
- The backend calls `adapter.createItem(token, entityType, outcome.title, outcome.description)`, then immediately fetches the new item's details (and child progress) and stores them in `cached_details` alongside an ETag.
- The new external link is created with `connection_state = 'published'` and broadcast over SSE so any open clients reflect the change without reload.
- Errors from the provider (e.g. attempting to publish as a non-creatable type) surface as `502 BACKEND_ERROR` with the provider's error message.

### Existing manual link support

Manual link entry continues to work for providers without an adapter:
- Select provider, paste entity type (epic/feature/story/issue/ticket) and ID
- Multiple links per outcome, across different providers
- Links displayed in outcome detail with provider and type badges
- No fragment mapping

---

## Search (v1)

Full-text search across:
- Outcome titles and descriptions
- Motivation titles and notes
- Tag names

Single search bar in the top nav. Results grouped by type (outcomes, motivations). Quick and essential for growing data.

---

## Export / Import (v1)

Enables PMs to export the timeline to Excel or Markdown for offline review, stakeholder sharing, and bulk editing — then import changes back with a structured diff review.

### Export

#### Excel — GET /export/timeline

Generates an `.xlsx` file with one sheet per milestone plus a Backlog sheet for unassigned outcomes.

Each sheet uses a **right-joined layout**: motivations are the primary rows, joined to their parent outcomes. Outcome cells (title, description, effort, status, tags) are **merged vertically** across all motivation rows belonging to that outcome. Each motivation row contains the motivation's own fields (title, type, status) plus **type-specific attribute columns** (revenue_at_risk, confidence, target_date, incident_frequency, etc.).

Outcomes with no motivations still appear as a single row with empty motivation columns.

#### Markdown — GET /export/timeline/markdown

Generates a `.md` file grouped by milestone. Each milestone is a heading, outcomes are listed with their title, effort, status, and score. Motivations are listed beneath each outcome with type, title, and key attributes.

### Import

#### Diff detection — POST /import/timeline/diff

Upload a modified `.xlsx` file (originally exported via GET /export/timeline). The server compares it against current database state and returns detected changes:

- **Outcome field edits** — title, description, effort, status, or tags changed
- **Motivation attribute changes** — type-specific attributes (revenue, dates, confidence, etc.) edited
- **Milestone moves** — an outcome appears on a different sheet than its current milestone
- **New outcomes** — rows with no matching outcome ID
- **Deleted outcomes** — outcomes present in the database but missing from the spreadsheet

#### Apply changes — POST /import/timeline/apply

Accepts the diff payload with user-selected changes to apply. Each applied change is recorded in the audit trail (attributed to the importing user, with source: "import").

For deleted outcomes, the user chooses **archive** (status set to archived, preserving history) or **delete** (hard removal). Archive is the default and recommended option.

### UI

- **Timeline header** gains three buttons: Export Excel, Export Markdown, and Import
- Export buttons trigger direct file downloads
- Import button opens a file picker, uploads the `.xlsx`, and opens the **ImportReview side panel**
- The ImportReview panel displays detected changes grouped by type (edits, moves, additions, deletions), with checkboxes to select which changes to apply
- User reviews, selects changes, and clicks Apply — changes are written with audit trail

---

## Workflow (v1)

1. **Create outcome** — title + optional markdown description + optional effort estimate
2. **Attach motivations** — link existing or create new (title required, all other fields optional, progressive disclosure)
3. **Score is computed** — automatically from motivation attributes
4. **Review ranked board** — outcomes sorted by priority, default filter: active + approved only
5. **Collaborate** — anyone can add motivations, adjust attributes, add tags
6. **Schedule** — drag outcome cards on the Timeline view between milestone columns (or to/from the backlog) to reassign their target milestone. Within-column order stays driven by priority score; manual reordering is intentionally not supported.
7. **Approve / Defer / Complete** — status changes with audit trail
8. **Pin if needed** — manual override with transparency
9. **Link to external system** — paste entity IDs (ValueEdge, Jira, GitHub Issues, etc.) for traceability

---

## Technical Architecture (v1)

### Stack

- **Frontend** — SPA (lightweight, fast)
- **Backend** — REST API
- **Database** — relational with JSONB for motivation type-specific attributes
- **Background jobs** — daily cron for date-based score recalculation

No SSE in v1. Collaboration via polling or manual refresh.

### API Design (v1)

#### Outcomes

- POST /outcomes
- GET /outcomes/:id
- PUT /outcomes/:id
- PATCH /outcomes/:id/pin
- GET /outcomes (filter by tags, status, motivation type; sort by priority_score; search)

#### Motivations

- POST /motivations
- GET /motivations/:id
- PUT /motivations/:id
- GET /motivations (filter by type, tags, status; search)
- PATCH /motivations/:id/resolve
- PATCH /motivations/:id/reopen
- POST /motivations/:id/link/:outcome_id
- DELETE /motivations/:id/link/:outcome_id

#### Motivation Types

- GET /motivation-types

#### Tags

- GET /tags
- POST /tags
- PUT /tags/:id
- DELETE /tags/:id

#### Milestones

- GET /milestones
- POST /milestones
- PUT /milestones/:id
- DELETE /milestones/:id

#### Scoring

- GET /outcomes/:id/score (breakdown by motivation, human-readable summaries)

#### External Links

- POST /outcomes/:id/external-links (requires provider field)
- DELETE /external-links/:id

#### Backend Integration

- GET /api/backend/search — search backend for items to connect
- GET /api/backend/entity-types — list available entity types for a provider
- POST /api/outcomes/:id/connect — connect an outcome to an existing backend item
- POST /api/outcomes/:id/publish — create a new backend item from an outcome
- POST /api/external-links/:id/refresh — force-refresh cached details for a link

#### Comments

- GET /outcomes/:id/comments?limit=N&offset=N
- POST /outcomes/:id/comments

#### History

- GET /outcomes/:id/history?limit=N&offset=N
- GET /motivations/:id/history?limit=N&offset=N

#### Search

- GET /search?q=term

#### Export / Import

- GET /export/timeline
- GET /export/timeline/markdown
- POST /import/timeline/diff
- POST /import/timeline/apply

---

## UI (v1)

### Navigation

Three top-level views plus a summary strip:

#### Outcomes View
- Outcomes listed by priority score (pinned items at top, then by score)
- Each row: title, score (with human-readable summary on hover), tags, motivation type pills, earliest date, effort badge, status, **creator avatar**
- Default filter: active + approved (deferred/completed/archived hidden, togglable)
- Filter by: tags, status, motivation type — combinable
- Search bar in top nav
- Click through to Outcome Detail

#### Motivations View
- Motivations listed and groupable by type
- Each row: title, type, score, human-readable summary, tags, linked outcome count, earliest date, **creator avatar**
- Filter by: tags, type, status (active/resolved), score threshold
- Sort by: score, date, linked outcome count
- Surfaces orphaned (unlinked) and broadly-shared motivations
- Click through to Motivation Detail

#### Timeline View (default landing view)
- Split layout: Backlog column on the left, milestones stacked vertically on the right
- **Milestone section headers** show: name, target date, countdown, outcome count, **effort summary** (tally of t-shirt sizes), edit/delete actions on hover
- Outcomes without a milestone appear in the Backlog sidebar
- Each outcome card shows: title, score, effort badge, motivation type pills
- Milestones with approaching dates are visually highlighted (amber < 30 days, red < 7 days)
- Click an outcome card to open Outcome Detail in a sidebar panel
- **Drag outcomes between milestones** and from backlog — milestone assignment without opening the detail panel
- Create new milestones inline from the timeline header

#### Summary Strip (top of Outcomes View)
- A compact dashboard bar above the outcomes list — always visible, not a separate page
- Shows: total active outcomes, total motivations, nearest deadline, effort breakdown, motivation type distribution (e.g. "8 customer, 3 tech debt, 2 compliance")
- All metrics are derived generically — no assumptions about specific motivation type schemas
- Filterable — responds to tag/status filters
- Enough for a quick screenshot in a steering deck

#### Tag Filtering (shared across all views)
- Tag filter bar available in all views — select tags to narrow results
- Tags clickable anywhere to filter
- Saved filter presets for common views (e.g. "Q3 platform work")

### Outcome Detail

Fixed header with: **creator avatar + name**, status, effort, milestone, tags, actions (Edit, Archive, Pin/Unpin)

Scrollable body:
1. Description (rendered markdown)
2. Priority score with breakdown (which motivations contribute what, with human-readable summaries)
3. Linked motivations (add existing / create new) — each shows **creator avatar**, clickable to Motivation Detail. **Date mismatch indicators**: motivations with target dates earlier than the milestone date show a warning (1-89 days) or critical (>90 days) indicator with an explanatory message. Summary badges in the section header.
4. External links (add / remove — ValueEdge, Jira, GitHub Issues, etc.)
5. Comments — lightweight timestamped notes thread for context that isn't a scored motivation (e.g. "Spoke to Acme CTO, flexible on date if we give them beta access")
6. History (3 recent, paginated)

### Motivation Detail

Fixed header with: **creator avatar + name**, type badge, status (active/resolved), actions (Edit, Resolve, Delete)

Scrollable body:
1. Type and attributes — **progressive disclosure form**: title prominent, other fields collapsed until needed. Expand to fill in details later.
2. Computed score with human-readable summary
3. Linked outcomes — clickable to Outcome Detail
4. History (3 recent, paginated)

#### Resolving a Motivation

When a motivation is no longer valid (e.g. customer renewed anyway, regulation deadline extended):
- Click "Resolve" — motivation status changes to resolved
- Resolved motivations are **excluded from scoring** — linked outcomes' priority scores update immediately
- The motivation is preserved in history and remains visible (greyed out) on linked outcomes
- Can be reopened if circumstances change
- Audit trail records who resolved it and when

### Motivation Creation (Progressive Disclosure)

Critical for low friction:
1. Quick-create: just title + type → done (15 seconds)
2. All other fields collapsed by default, expandable
3. Score shows immediately from whatever fields are filled — improves as attributes are added
4. Can be fleshed out later without disrupting flow

### Cross-Navigation

- Outcome → its motivations → other outcomes sharing those motivations
- Motivation → its outcomes → other motivations on those outcomes

### Shareable URLs

All filter state is encoded in the URL. Sharing a link opens Moou with the same view, filters, and selected entity. Examples:
- `moou.app/timeline?milestone=q2-2026` — timeline filtered to Q2
- `moou.app/outcomes?tags=EMEA&status=active` — EMEA active outcomes
- `moou.app/outcomes/42` — specific outcome detail

This lets PMs send a link to a VP that opens exactly the view they prepared.

### Comments (on Outcomes)

Lightweight timestamped notes for context that isn't a scored motivation:
- "Spoke to Acme's CTO — flexible on date if we give them beta access"
- "Legal confirmed this is P1, awaiting formal sign-off"
- "Engineering spike completed — effort estimate updated to L"

Each comment records author and timestamp. Comments are not scored — they're context alongside motivations. Keeps the system from forcing everything into a structured motivation when a quick note is what's needed.

---

### Admin (v1)

#### Tags
- Rename, merge, delete
- Update emoji, colour, description
- Usage counts

#### Motivation Types
- View-only in v1 (types configured via seed data)
- Shows attribute schemas and formulas for transparency

---

## Constraints (v1)

- Outcome creation < 30 seconds (title only)
- Motivation creation < 15 seconds (title + type only)
- Full motivation with all attributes < 2 minutes
- Linking a motivation to an outcome: one click
- Score recalculation: daily batch, < 1 second per outcome
- Default view shows active + approved only
- All fields optional except title

---

## Non-Goals (v1)

- No block-based rich text editor (markdown is sufficient)
- No description fragment-to-external-system mapping
- No split UI
- No SSE / real-time collaboration
- No runtime motivation type editing (admin UI)
- No formula editor UI
- No timeline/roadmap view
- No dashboard/summary view
- No bulk operations
- No AI-driven features
- No real SSO (mocked — GitHub OAuth is the exception, required for backend integration)

---

# V2+ — Detailed Design (Preserved)

Everything below has been designed in detail and is ready to implement once v1 is validated.

---

## V2a: Rich Description Editor

### Block-Based Format

The description becomes **block-based rich text** — an ordered list of blocks instead of a flat markdown string.

#### Block Types

| Block Type | Rendering | Use |
|-----------|-----------|-----|
| heading | H2/H3 | Section headers within the description |
| paragraph | Body text | Primary content |
| list-item | Bulleted/numbered | Requirements, acceptance criteria |
| code | Monospace block | Technical details, config examples |
| quote | Indented, styled | Stakeholder quotes, references |

#### Inline Formatting

Within any block: **bold**, *italic*, `code`, [links], ~~strikethrough~~.

Input via markdown shortcuts (e.g. `**bold**`, `# heading`) or a minimal floating toolbar on text selection. Same patterns as Notion, Linear, or GitHub issue editors.

#### Block Data Model

Each block is:
- id (stable identifier — survives reordering)
- type (heading | paragraph | list-item | code | quote)
- content (text with inline formatting spans)
- links[] (optional — external system and/or outcome links attached to this block)
  - link_type: "external" | "outcome"
  - For external: provider (valueedge | github | jira | ...), entity_type (epic | feature | story | issue | ticket), entity_id
  - For outcome: outcome_id, outcome_title (denormalised for display)
  - handled_elsewhere (boolean) — marks this block as moved/delegated

Links attach to **blocks, not character ranges**.

---

## V2b: Fragment-to-External-System Mapping

### Reading Mode

- Text is clean and readable by default
- A narrow left gutter shows coloured bars indicating linked blocks:
  - Epic = blue bar spanning all blocks linked to that epic
  - Feature = teal, nested within
  - Story = amber, typically single blocks
- Bars stack side by side when overlapping (like nested scope markers)
- Hovering a gutter bar highlights the associated blocks and shows the entity badge
- Hovering linked text shows an inline tooltip with the entity

### Handled-Elsewhere Blocks

When a block's work has moved to another outcome:
- Text is struck through and dimmed — context preserved, clearly not active
- Inline chip after the struck text: `→ Outcome Name` (clickable, navigates)
- Gutter bar renders as dashed to visually distinguish
- Excluded from splitting operations

### Editing Mode

- Block-based editor with markdown shortcuts and floating toolbar
- Add/remove/reorder blocks by typing or dragging
- Link a block: select it → popover offers "Link to External System" or "Link to Outcome"
- "Mark as handled elsewhere" option when linking to another outcome
- Can remove "handled elsewhere" status to bring a block back to active

---

## V2c: Split UI

Splitting operates on **blocks** — the fundamental unit of the description.

### Split Workflow

1. User clicks "Split" — description shows blocks as selectable cards (two-column kanban)
2. Left column: blocks staying on the original outcome
3. Right column(s): blocks for each new outcome (can create multiple)
4. User drags blocks between columns — or clicks to toggle
5. Blocks with external system links show their entity badges
6. Handled-elsewhere blocks are greyed out and pinned to the original

### After Split

- Blocks assigned to new outcomes are marked as "handled elsewhere" on the original
- The original shows strikethrough text with navigation links to new outcomes
- External links on moved blocks transfer (or copy — user's choice)
- Motivations are optionally shared with new outcomes (linked, not copied)
- Shared motivations act as a natural grouping mechanism — no formal parent-child hierarchy

---

## V2d: Real-Time Collaboration (SSE)

- SSE endpoint for live updates: score changes, new motivations, status changes, new links
- Score recalculation pushed to connected clients as deadlines shift
- Multiple users see changes immediately without refresh
- Optimistic UI updates with conflict resolution

---

## V2e: Extensible Motivation Type Admin

Runtime admin UI for motivation types:
- Define/edit attribute schemas
- Define/edit scoring formulas
- Preview scoring with sample data
- Versioning — formula changes don't retroactively alter historical scores

### Scoring Governance

- Changes to formulas require admin role
- All formula changes are audited
- "Preview" mode shows how a formula change would affect current rankings before applying

---

## V2f: Enhanced Timeline

The basic milestone-grouped timeline ships in v1. V2 adds:
- Horizontal swimlanes by product area, team, or custom tag grouping
- Drag outcomes to adjust milestone assignment or target dates
- Dependency lines between outcomes
- Milestone-level progress indicators (% of outcomes completed)

---

## V2g: Enhanced Dashboard

The summary strip ships in v1. V2 adds:
- Dedicated dashboard page with full-width charts
- Motivation type distribution (pie/bar)
- Score trend over time (how priorities shifted)
- Milestone progress tracking
- Exportable PDF/image for steering meetings

---

## V2h: Bulk Operations

- Multi-select outcomes or motivations
- Bulk tag, bulk status change, bulk effort update
- Bulk link motivations to an outcome

---

## V2i: Onboarding

- Guided first-run flow: create first outcome, first motivation, see score compute
- Seed data option: pre-populated example data to explore
- In-app tooltips explaining scoring and navigation

---

## Future Enhancements (beyond V2)

- Real SSO integration (ValueEdge, Okta, etc.)
- External system API integration (create epics/features/issues from outcomes — ValueEdge, Jira, GitHub Issues)
- AI-assisted summarisation and deduplication
- CRM integration (Salesforce — auto-create customer demand motivations)
- Support system integration (auto-create tech debt motivations from incident data)
- Usage analytics integration
- Notification system (alert when an outcome crosses a priority threshold)
- Score dilution warnings (motivation linked to too many outcomes)
- Portfolio-level cross-team prioritisation

---

## Market Context

No existing tool ships this exact model. The closest comparisons:

- **Dragonboat** — outcome-driven, many-to-many linking, but no typed motivations or auto-scoring
- **Productboard** — reusable "drivers" but they're scoring dimensions, not entities with attributes
- **Fibery** — flexible enough to build this, but no pre-built template
- **Teresa Torres' OST** — closest conceptual ancestor, but a thinking framework, not a scoring system

The novel combination: **typed motivation entities with extensible schemas + many-to-many linking to outcomes + formula-driven auto-ranking with time decay**.
