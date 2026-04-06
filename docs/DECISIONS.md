# Architecture Decision Records

Decisions made during design that are non-obvious and worth recording. Each entry explains what was decided, what alternatives were considered, and why.

---

## ADR-001: Motivations as shared many-to-many entities

**Decision:** Motivations are first-class entities linked to outcomes many-to-many, not per-outcome scoring fields.

**Alternatives considered:**
- Per-outcome scoring (like Productboard's drivers) — each outcome gets its own scores on fixed dimensions
- Shared objectives (like Dragonboat) — but all the same type, no attribute schemas

**Why:** A single customer demand (e.g. "Acme Corp needs masking performance") can motivate multiple outcomes. Duplicating it per-outcome means updating the same data in multiple places when things change (revenue figure updated, date shifts). Shared motivations also act as a natural grouping mechanism after splitting outcomes.

**Trade-off:** More complex data model. Risk of motivations being linked too broadly and becoming meaningless. Mitigated by UI surfacing link counts so overuse is visible.

---

## ADR-002: Formula-based scoring stored as configuration

**Decision:** Each motivation type defines a scoring formula as a string expression (e.g. `revenue_at_risk * date_urgency(target_date) * confidence`), evaluated at runtime.

**Alternatives considered:**
- Weighted attribute mapping — tag each attribute with a weight, apply standard weighted-sum
- Code-level plugins — scoring logic in actual code per type

**Why:** Formulas in the data layer mean scoring can be adjusted without a deploy. Different motivation types genuinely need different formulas — a weighted sum can't express "incident_frequency * blast_radius_weight" elegantly. Code plugins are more powerful but require developer involvement for every change.

**Trade-off:** Need to build a formula parser/evaluator. Formulas can be written incorrectly. Mitigated in v1 by shipping formulas as built-in config (not user-editable UI), with a type admin UI planned for v2.

---

## ADR-003: No customer entity in v1

**Decision:** Customer names are freetext strings within Customer Demand motivation attributes, not references to a Customer entity.

**Alternatives considered:**
- Lightweight Customer lookup table (id, name, segment, strategic flag) with foreign key from motivations
- CRM integration for customer data

**Why:** A Customer entity adds scope — deduplication logic, CRUD UI, import flows. The summary strip was redesigned to use generic metrics (motivation counts, type breakdown) rather than customer-specific aggregations, removing the primary driver for a Customer entity. Freetext is sufficient for v1 where the user base is small and disciplined.

**Trade-off:** No deduplication ("Acme Corp" vs "Acme" vs "ACME" are different strings). Acceptable for v1. Customer entity is a candidate for v2 if needed.

---

## ADR-004: Milestones as a separate entity, not tags

**Decision:** Milestones are their own entity with a target date, not a special kind of tag.

**Alternatives considered:**
- Tags with a date field (overloading the tag concept)
- No milestones — just use tags like `release:Q3-2026`

**Why:** Tags don't have dates, and the timeline view needs real dates to sort and display milestones. Milestones also have derived fields (effort summary, outcome count) that don't fit the tag model. The timeline view is a first-class navigation path and needs a proper entity backing it.

**Trade-off:** Another entity to manage. Mitigated by keeping milestones very lightweight (5 fields).

---

## ADR-005: Moou/External Systems boundary

**Decision:** Moou owns what/why (outcomes, motivations, milestones, priority). External systems (ValueEdge, Jira, GitHub Issues, etc.) own who/how (squads, sprints, stories, delivery tracking). Moou does not duplicate execution concerns.

**Alternatives considered:**
- Adding team assignment and capacity tracking to Moou
- Building Moou as a layer within a specific external system (e.g. ValueEdge)

**Why:** Moou is a precursor to an external system's agile processes, not a replacement. Duplicating execution concerns creates data divergence and maintenance burden. The link between the two is the external entity ID (scoped by provider) on an outcome — engineers trace back to "why" via that link.

**Trade-off:** Users need two tools. Sarah (DoE) can't see squad-level capacity in Moou — she uses tags like `team:platform` for rough grouping, but real assignment happens in the external system.

---

## ADR-006: Block-based editor deferred to v2

**Decision:** v1 uses plain markdown for outcome descriptions. The block-based rich text editor with fragment-to-external-system mapping, handled-elsewhere strikethrough, and block-based split UI is deferred to v2.

**Alternatives considered:**
- Shipping the block editor in v1
- Using a WYSIWYG editor (e.g. TipTap/ProseMirror) in v1

**Why:** The block editor is a significant build — custom renderer, fragment mapping, split UI, gutter bars. v1 needs to prove the core model (outcomes, motivations, scoring) works before investing in the editor. Markdown is sufficient and familiar. The block-based design is fully specified in the spec and ready to implement when validated.

**Trade-off:** No fragment-to-external-system mapping or visual split UI in v1. Splitting is simpler — create new outcomes manually, re-link motivations. Acceptable for early usage.

---

## ADR-007: Summary strip uses generic metrics only

**Decision:** The summary strip shows motivation counts, type breakdown, effort distribution, and nearest deadline — no customer-specific or revenue-specific aggregations.

**Alternatives considered:**
- Showing total revenue at risk and customer count (derived from Customer Demand motivations)

**Why:** Pulling revenue and customer data into the summary strip promotes specific fields from the flexible motivation schema into first-class UI concepts. This breaks the extensibility model and assumes Customer Demand motivations always exist with those fields. Generic metrics work with any motivation type configuration.

**Trade-off:** PMs can't see a revenue headline number at a glance. They can see it per-motivation in the detail view. If revenue summaries become critical, they could be added in v2 via "summary-eligible" field tagging on motivation type schemas.

---

## ADR-008: Motivation lifecycle — resolve, don't delete

**Decision:** Motivations can be resolved (excluded from scoring, preserved in history) rather than deleted.

**Alternatives considered:**
- Delete only (with confirmation)
- Archive (hidden from all views)

**Why:** Deleting a motivation that contributed to priority scores creates confusing audit history — "why did this outcome drop from 842 to 500 last Tuesday?" Resolved motivations stay visible (greyed out) on linked outcomes, preserving context. They can be reopened if circumstances change. This matches how the real world works — a customer demand doesn't disappear, it gets resolved.

**Trade-off:** Resolved motivations accumulate over time. Mitigated by filtering (default view shows active motivations) and the motivations view surfacing resolved items separately.

---

## ADR-009: Vue over React, no CSS framework

**Decision:** Frontend built with Vue 3 + TypeScript + Vite. Styling via CSS variables and Vue scoped styles, no Tailwind or other CSS framework.

**Alternatives considered:**
- React + Tailwind (the "safe" recommendation for Claude-assisted development)
- Svelte (smaller but less ecosystem)

**Why:** This project is built solo with Claude. Vue's single-file components (template + script + style together) reduce context switching and boilerplate. Vue's built-in reactivity handles SSE-driven state updates more naturally than React's re-render model. The mockup already defines a complete design language with CSS variables — adding Tailwind would mean translating that into utility classes for no gain. Scoped styles in Vue SFCs keep styling co-located with components.

**Trade-off:** Vue has a smaller ecosystem than React. Acceptable — this project doesn't need a large component library ecosystem.

---

## ADR-010: Single-process deployment, no Redis

**Decision:** Background jobs run in-process via node-cron. SSE uses an in-process EventEmitter. No Redis, no message queue. Deployment is a single app container + PostgreSQL via docker-compose.

**Alternatives considered:**
- BullMQ + Redis for job queue and SSE fan-out
- Separate worker process for background jobs

**Why:** This is a small-scale internal tool, not a high-traffic service. Daily score recalculation is a single cron job that reads motivations and writes scores — it doesn't need bulletproof delivery guarantees. SSE fan-out across multiple server instances is unnecessary when there's one instance. Adding Redis doubles the infrastructure for no practical benefit at this scale.

**Trade-off:** Can't horizontally scale the backend without adding Redis for SSE fan-out. Acceptable — this tool will have tens of users, not thousands.

---

## ADR-011: Provider-agnostic external links

**Decision:** External links on outcomes use a provider-agnostic model: each link carries a `provider` field (e.g. `valueedge`, `github`, `jira`) alongside `entity_type`, `entity_id`, and `url`. The API endpoint is `/external-links`, not `/valueedge-links`.

**Alternatives considered:**
- ValueEdge-specific link model (`valueedge_links`) with a separate model per provider added later
- Generic URL-only bookmarks with no structured provider/entity fields

**Why:** ValueEdge is the primary execution system today, but teams also track work in GitHub Issues, Jira, and other tools. A provider-agnostic model avoids a schema migration when a second provider is needed. The `provider` field enables provider-specific display (badges, URL templates) without separate tables or endpoints per provider. Entity types vary by provider (epic/feature/story for ValueEdge, issue for GitHub, ticket/epic for Jira) — the flexible `entity_type` string accommodates this.

**Trade-off:** Slightly more complex link creation (user selects provider). Mitigated by defaulting to ValueEdge in the UI and offering provider-specific entity type dropdowns. No additional API complexity — one endpoint handles all providers.

---

## ADR-012: Timeline export/import with right-joined motivation rows

**Decision:** The Excel export uses a right-join of motivations to outcomes, with outcome cells merged vertically across their motivation rows. Each motivation row includes type-specific attribute columns (revenue_at_risk, confidence, target_date, incident_frequency, etc.) as individually editable cells.

**Alternatives considered:**
- One row per outcome with motivations summarised as a comma-separated string in a single cell

**Why:** The right-join layout preserves individual motivation attributes (revenue, dates, confidence) as separate editable columns in the spreadsheet. This is critical for the import diff — the system can detect changes to specific motivation attributes (e.g. "revenue_at_risk changed from 500000 to 750000"), not just whether the outcome-level summary text was modified. PMs can edit motivation data directly in the spreadsheet using familiar Excel workflows, and the import diff shows precisely what changed at the attribute level.

**Trade-off:** Larger spreadsheet with more rows (one per motivation rather than one per outcome), and more complex merge-cell logic for the outcome fields. But the PM gets direct access to edit the data that drives priority scores, and the import can produce a granular, auditable diff.

---

## ADR-013: Scale currency in scoring formulas with k()

**Decision:** Scoring formulas use a built-in `k()` function that divides by 1000. Users enter real currency values (£1,800,000), but the formula computes `k(revenue_at_risk)` = 1800. Scores end up in the hundreds/low thousands instead of millions.

**Alternatives considered:**
- Normalize to 0-100 at API response time (top = 100, others relative) — rejected because scores shift when new items are added, confusing users
- Store values in thousands (user enters 1800 meaning £1.8M) — rejected because data loses fidelity and users must mentally convert
- Log scale — rejected because non-intuitive ("what does 6.5 mean?")
- Display raw millions — rejected because 2,884,500 vs 1,655,893 is unreadable

**Why:** k() is explicit in the formula, stable (scores don't shift when other items change), and the stored data stays honest. The PM sees £1,800,000 in the motivation attributes and a score of 1,620 — both make sense. Non-currency fields (incident counts, hours, deals lost) are not scaled.

**Trade-off:** Scoring function authors must remember to wrap currency fields with k(). If they forget, scores spike to millions. Mitigated by the built-in motivation type formulas already using k() as examples.

---

## ADR-014: Bidirectional backend sync with explicit state management

**Decision:** Outcomes have three relationship states with backend items: Draft (moou-only, no backend representation), Connected (linked to an existing backend item), and Published (moou created the backend item). The user controls when data crosses the boundary. The backend system is authoritative for execution data (status, assignee, progress), while moou is authoritative for prioritisation data (motivations, scores, milestones).

**Alternatives considered:**
- Automatic two-way sync — rejected: too complex, conflict-prone. Deciding which side "wins" on every field creates subtle bugs and erodes trust in both systems.
- One-way push only (moou pushes to backend, never reads) — rejected: ignores existing data. Teams already have issues, epics, and tickets in their backend systems.

**Why:** Teams have existing issues and workflows in their backend systems. Forced migration into moou is a dealbreaker. The explicit Draft -> Connected/Published flow respects existing workflows: teams can connect moou outcomes to issues that already exist, or publish new items when they're ready. The boundary is clear — moou decides *what* and *why*, the backend system tracks *who* and *how*.

**Trade-off:** More UI complexity — three relationship states (Draft, Connected, Published) to display and explain. Users must manually connect items rather than having it happen automatically. Acceptable because the explicit control builds trust and avoids the "magic sync" problems that plague bidirectional integrations.

**Phase 4 follow-ups (publish flow):**
- The "Publish" affordance is only shown for outcomes in the implicit Draft state (no external links). Once an outcome is connected or published, additional linking goes through Connect, not Publish — this keeps the mental model "publish creates one canonical item per outcome" and stops users from accidentally creating duplicate backend items.
- Entity types that cannot be created from a title + description alone (e.g. GitHub pull requests, which require head/base branches) are filtered out of the publish picker. The provider adapter is the source of truth for what's creatable: `createItem` throws for unsupported types and the route surfaces that as `502 BACKEND_ERROR`. Filtering on the client is a UX nicety; the backend remains authoritative.
- When a provider exposes a single creatable entity type, the publish picker collapses to a static label rather than a single-option dropdown, mirroring how Connect handles single-type providers.
