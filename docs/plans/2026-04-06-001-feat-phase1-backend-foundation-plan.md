---
title: "Phase 1: Backend Foundation"
type: feat
status: active
date: 2026-04-06
origin: docs/PLAN.md
deepened: 2026-04-06
---

# Phase 1: Backend Foundation

## Enhancement Summary

**Deepened on:** 2026-04-06
**Research areas:** Drizzle ORM patterns, formula evaluation libraries, SSE implementation, deep diffing, ajv validation, Docker + monorepo setup

### Key Improvements
1. **filtrex** selected as formula evaluator — safest sandbox, 12kb, compile-once pattern, verified with exact formula syntax
2. **microdiff** selected for deep diffs — 0.9kb, fastest, native TypeScript, dotted-key output
3. **text + check constraints** over pgEnum for enums — avoids painful enum migration issues in Drizzle
4. Concrete package versions, tsconfig settings, Docker patterns grounded in current docs
5. Graceful shutdown pattern and health check cooperation added

### New Considerations Discovered
- Express 5.2.1 is current — use it (native async error handling, no need for express-async-errors)
- `ajv` must import from `ajv/dist/2020` for JSON Schema 2020-12 (default export uses draft-07)
- Drizzle `count()` returns bigint (string in JS) — must cast to int
- `composite: true` required in tsconfig for project references to work
- Keep `drizzle-orm` in one workspace only to avoid duplicate instance issues
- expr-eval has a critical CVE (CVE-2025-12735) — do not use

---

## Overview

Build the complete backend for Moou — database schema, REST API, scoring engine seed data, mock auth, and audit history. No UI. Testable via curl or REST client.

This is the foundation everything else builds on. Getting the data model and API right here means the Vue frontend (Phase 3+) is just a rendering layer.

## Origin

- **Spec:** [docs/SPEC.md](../SPEC.md) — full domain model, scoring system, API endpoints
- **Plan:** [docs/PLAN.md](../PLAN.md) — tech stack (Express + TypeScript + Drizzle + PostgreSQL), build phases
- **Decisions:** [docs/DECISIONS.md](../DECISIONS.md) — ADRs 001-010

## Technical Approach

### Architecture

Single Express 5 server in TypeScript. PostgreSQL via Drizzle ORM. Monorepo with shared types.

```
moou/
├── api/
│   ├── src/
│   │   ├── index.ts              # Express server entry + graceful shutdown
│   │   ├── routes/
│   │   │   ├── outcomes.ts
│   │   │   ├── motivations.ts
│   │   │   ├── milestones.ts
│   │   │   ├── tags.ts
│   │   │   ├── comments.ts
│   │   │   ├── scoring.ts
│   │   │   └── search.ts
│   │   ├── db/
│   │   │   ├── schema.ts         # Drizzle schema (all tables)
│   │   │   ├── index.ts          # DB connection + client export
│   │   │   └── seed.ts           # Seed motivation types + mock users
│   │   ├── scoring/
│   │   │   ├── evaluator.ts      # filtrex-based formula evaluator
│   │   │   ├── functions.ts      # Built-in functions (date_urgency, etc.)
│   │   │   └── recalculate.ts    # Batch recalculation logic
│   │   ├── middleware/
│   │   │   └── auth.ts           # Mock auth (reads X-User-Id header)
│   │   ├── sse/
│   │   │   └── emitter.ts        # In-process EventEmitter + SSE endpoint
│   │   └── lib/
│   │       ├── validate.ts       # JSONB attribute validation via ajv
│   │       ├── diff.ts           # microdiff-based deep diff for history
│   │       └── history.ts        # Audit trail recording helper
│   ├── drizzle/                  # Generated migration SQL files
│   ├── drizzle.config.ts         # Drizzle Kit config
│   ├── package.json
│   └── tsconfig.json
├── shared/
│   ├── src/
│   │   └── types.ts              # Entity types, enums, API request/response types
│   ├── package.json
│   └── tsconfig.json
├── app/                          # Empty until Phase 3
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json                  # Workspace root
└── tsconfig.json                 # Solution-style references
```

### ERD

```mermaid
erDiagram
    OUTCOMES ||--o{ OUTCOME_MOTIVATIONS : has
    MOTIVATIONS ||--o{ OUTCOME_MOTIVATIONS : has
    MOTIVATION_TYPES ||--o{ MOTIVATIONS : defines
    OUTCOMES ||--o{ OUTCOME_TAGS : has
    MOTIVATIONS ||--o{ MOTIVATION_TAGS : has
    MILESTONES ||--o{ MILESTONE_TAGS : has
    TAGS ||--o{ OUTCOME_TAGS : used_by
    TAGS ||--o{ MOTIVATION_TAGS : used_by
    TAGS ||--o{ MILESTONE_TAGS : used_by
    MILESTONES ||--o{ OUTCOMES : groups
    OUTCOMES ||--o{ VALUEEDGE_LINKS : has
    OUTCOMES ||--o{ COMMENTS : has
    OUTCOMES ||--o{ HISTORY : tracked_by
    MOTIVATIONS ||--o{ HISTORY : tracked_by
    USERS ||--o{ OUTCOMES : creates
    USERS ||--o{ MOTIVATIONS : creates
    USERS ||--o{ COMMENTS : creates

    USERS {
        text id PK "e.g. sarah-chen"
        text name
        text role
        text initials
    }

    OUTCOMES {
        uuid id PK
        text title "required"
        text description "markdown"
        text effort "enum: XS|S|M|L|XL, nullable"
        uuid milestone_id FK "nullable"
        text status "enum: draft|active|approved|deferred|completed|archived"
        boolean pinned "default false"
        numeric priority_score "computed, default 0"
        text created_by FK
        timestamp created_at
        timestamp updated_at
    }

    MOTIVATIONS {
        uuid id PK
        uuid type_id FK "required"
        text title "required"
        text status "enum: active|resolved, default active"
        text notes "nullable"
        jsonb attributes "validated against type schema"
        numeric score "computed, default 0"
        text created_by FK
        timestamp created_at
        timestamp updated_at
    }

    MOTIVATION_TYPES {
        uuid id PK
        text name "unique"
        text description
        jsonb attribute_schema "JSON Schema 2020-12 document"
        text scoring_formula
        timestamp created_at
        timestamp updated_at
    }

    MILESTONES {
        uuid id PK
        text name
        date target_date
        text type "enum: release|deadline|review, nullable"
        text description "nullable"
        text status "enum: upcoming|active|completed"
        text created_by FK
        timestamp created_at
        timestamp updated_at
    }

    TAGS {
        uuid id PK
        text name "unique, case-insensitive via lower() index"
        text emoji "nullable"
        text colour "hex #RRGGBB"
        text description "nullable"
    }

    OUTCOME_MOTIVATIONS {
        uuid outcome_id FK PK
        uuid motivation_id FK PK
        text created_by FK
        timestamp created_at
    }

    OUTCOME_TAGS {
        uuid outcome_id FK PK
        uuid tag_id FK PK
    }

    MOTIVATION_TAGS {
        uuid motivation_id FK PK
        uuid tag_id FK PK
    }

    MILESTONE_TAGS {
        uuid milestone_id FK PK
        uuid tag_id FK PK
    }

    VALUEEDGE_LINKS {
        uuid id PK
        uuid outcome_id FK
        text entity_type "enum: epic|feature|story"
        text entity_id
        text url "nullable"
        text created_by FK
        timestamp created_at
    }

    COMMENTS {
        uuid id PK
        uuid outcome_id FK
        text body "required"
        text created_by FK
        timestamp created_at
    }

    HISTORY {
        uuid id PK
        text entity_type "outcome|motivation|outcome_motivation|valueedge_link"
        uuid entity_id
        text change_type "created|updated|deleted|linked|unlinked|resolved|reopened|pinned|unpinned"
        jsonb changes "deep diff: field -> old/new"
        text changed_by FK
        timestamp changed_at
    }
```

### Key Design Decisions Carried Forward

**Cascade rules:**

| Parent | Child | On Delete |
|--------|-------|-----------|
| Tag | outcome_tags, motivation_tags, milestone_tags | CASCADE |
| Milestone | outcomes.milestone_id | SET NULL |
| Outcome | outcome_motivations, outcome_tags, valueedge_links, comments, history | CASCADE |
| Motivation | Cannot be hard-deleted. Resolve only (ADR-008). |

**Enums:** Use `text` columns with check constraints, not `pgEnum`. Drizzle's pgEnum migration handling is painful when removing values (converts to text and back). Check constraints give DB-level enforcement without the migration cost.

**JSONB validation:** MotivationType.attribute_schema stores a JSON Schema (2020-12) document. Validated with `ajv` (imported from `ajv/dist/2020`) on motivation create and update. Unknown properties rejected. Validation errors return 400 with per-field details.

**History recording:**
- Deep JSONB diffs via **microdiff** — individual attribute fields tracked as dotted keys
- Link/unlink operations recorded with entity_type "outcome_motivation" and change_type "linked"/"unlinked"
- Create operations recorded with changes showing null → new value for each field
- Comments are append-only, not tracked in history (they ARE the history)
- Score recalculations not individually tracked in history (computed field, not user action)

**Auth:** Missing X-User-Id header → 401. Invalid user → 401. All mutations require auth. GET requests work without auth (for shareable URLs later).

**Response format:**
- Create: 201 + full entity body
- Update: 200 + full entity body
- Delete: 204 no content
- Validation error: 400 + `{error: {code: "VALIDATION_ERROR", message: string, details: object}}`
- Not found: 404 + `{error: {code: "NOT_FOUND", message: string}}`
- Auth error: 401 + `{error: {code: "UNAUTHORIZED", message: string}}`

**Pagination:** All list endpoints support `?limit=N&offset=N`. Default limit 50, max 100.

**Tag uniqueness:** Case-insensitive via `uniqueIndex().on(lower(table.name))` in Drizzle.

**Outcome status:** All transitions valid in v1. No transition matrix.

**Sorting:** Default sort for outcomes is `pinned DESC, priority_score DESC, created_at DESC`.

### Key Library Choices

| Library | Purpose | Version | Size | Why |
|---------|---------|---------|------|-----|
| **filtrex** | Formula evaluation | 3.1.0 | 12kb gzipped | Safest sandbox (no escape possible), compile-once pattern, supports arithmetic + custom functions. Verified with exact scoring formula syntax. |
| **microdiff** | Deep object diffing | latest | 0.9kb | Fastest diffing lib, native TS types, output maps directly to audit trail format (CREATE/CHANGE/REMOVE with path arrays). |
| **ajv** | JSON Schema validation | latest | — | Import from `ajv/dist/2020` for 2020-12. Compile schemas once (auto-cached). `allErrors: true` for full error reporting. |
| **ajv-formats** | Format validators | latest | — | Adds `date`, `date-time`, `email`, `uri` format validation removed since ajv v7. |
| **node-cron** | Daily score recalculation | latest | — | In-process cron. No Redis. |
| **express** | HTTP server | 5.2.1 | — | v5 has native async error handling — no need for express-async-errors wrapper. |
| **tsx** | Dev runner | 4.21+ | — | Direct .ts execution with watch mode. Faster than ts-node (uses esbuild). |
| **drizzle-orm** | ORM | 0.39+ | — | Install ONLY in api/ workspace to avoid duplicate instance issues. |

---

## Implementation Phases

### Step 1: Project Scaffolding

Set up the monorepo, TypeScript, and Docker.

- [ ] `package.json` (root) — `"private": true`, `"workspaces": ["api", "shared", "app"]`, TypeScript as root devDependency
- [ ] `tsconfig.json` (root) — solution-style: `"files": []`, `"references": [{"path": "./shared"}, {"path": "./api"}]`
- [ ] `shared/package.json` — `"name": "shared"`, `"type": "module"`, `"exports"` pointing to `dist/`
- [ ] `shared/tsconfig.json` — extends base, `"composite": true`, `"declaration": true`, `"declarationMap": true`
- [ ] `shared/src/types.ts` — entity types, enums, API request/response types
- [ ] `api/package.json` — Express 5, Drizzle, drizzle-kit, pg, ajv, ajv-formats, filtrex, microdiff, node-cron, cors, tsx. Dependency on `"shared": "workspace:*"`
- [ ] `api/tsconfig.json` — extends base, `"composite": true`, `"references": [{"path": "../shared"}]`
- [ ] `api/drizzle.config.ts` — Drizzle Kit config pointing to schema and PG connection
- [ ] `.env.example` — `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST=db`, `DB_PORT=5432`, `PORT=3000`
- [ ] `docker-compose.yml`:
    - PG 16 Alpine with healthcheck (`pg_isready`), named volume, port 5432 exposed
    - App service with `depends_on: db: condition: service_healthy`, bind mount for `api/src` and `shared/src`, tsx watch command
    - Network for inter-container communication
- [ ] `Dockerfile` — 3-stage: build (npm ci + tsc), deps (npm ci --omit=dev), runtime (node:22-alpine, copy dist + prod deps, `USER node`)
- [ ] `.gitignore` — node_modules, dist, .env, pgdata volume
- [ ] `api/src/index.ts`:
    - Express 5 app with JSON body parser, CORS (origin from env, default `http://localhost:5173`)
    - `GET /healthz` endpoint (returns 503 during shutdown)
    - Graceful shutdown on SIGTERM/SIGINT (stop accepting connections → drain → close DB pool → exit, 10s hard timeout)
    - Drizzle migration + seed run on startup (dev only)
- [ ] Verify: `docker compose up` starts PG + API, `curl localhost:3000/healthz` returns `{"status":"ok"}`

### Step 2: Database Schema

All tables via Drizzle schema definition.

- [ ] `api/src/db/schema.ts` — all tables from the ERD
    - users table — text PK (`id`), text name, role, initials
    - outcomes table — uuid PK via `defaultRandom()`, all fields. Effort/status as `text` with check constraints (not pgEnum). FK to milestones with `onDelete: 'set null'`, FK to users. Index on `milestone_id`, index on `created_by`, index on `(pinned DESC, priority_score DESC, created_at DESC)` for default sort
    - motivations table — uuid PK, all fields. FK to motivation_types, FK to users. `attributes` as `jsonb().$type<Record<string, unknown>>()`. `score` as `numeric` with default 0. Index on `type_id`, index on `score DESC`
    - motivation_types table — uuid PK, name unique, attribute_schema as jsonb, scoring_formula as text
    - milestones table — uuid PK, all fields including `updated_at`. Status as text with check constraint. FK to users. Index on `target_date`
    - tags table — uuid PK, case-insensitive unique index on `lower(name)`. Colour validated as `#RRGGBB` format
    - outcome_motivations — composite PK `(outcome_id, motivation_id)`, FK to users for `created_by`, `created_at` timestamp. Both FKs with `onDelete: 'cascade'`
    - outcome_tags, motivation_tags, milestone_tags — composite PKs, cascade deletes on both sides
    - valueedge_links — uuid PK, FK to outcomes with cascade delete, entity_type text with check constraint, FK to users
    - comments — uuid PK, FK to outcomes with cascade delete, FK to users. No `updated_at` (append-only)
    - history — uuid PK, entity_type + entity_id indexed together, change_type text with check constraint, changes jsonb, FK to users. Index on `(entity_type, entity_id, changed_at DESC)` for paginated reads
- [ ] `api/src/db/index.ts` — Drizzle client creation from `DATABASE_URL` env var, export `db` instance
- [ ] Use `drizzle-kit push` during dev, `drizzle-kit generate` to create migration files before commit
- [ ] Verify: tables created in PG, FK constraints and check constraints in place

#### Research Insights: Drizzle Patterns

- Use `uuid().defaultRandom().primaryKey()` — emits `gen_random_uuid()` in DDL
- Use `text` + check constraints for enums, not `pgEnum` — avoids painful migration when removing enum values
- Case-insensitive unique: define `function lower(col) { return sql\`lower(\${col})\` }`, then `uniqueIndex().on(lower(table.name))`
- Always index FK columns — PostgreSQL does not auto-index them (unlike MySQL)
- `count()` returns bigint (string in JS) — use `sql<number>\`cast(count(*) as int)\`.mapWith(Number)`
- AND tag filtering uses relational division: join to tags, group by outcome, `HAVING count(DISTINCT tag_id) = N`

### Step 3: Seed Data

- [ ] `api/src/db/seed.ts` — idempotent seed script (check if data exists before inserting)
    - 4 mock users: `sarah-chen` (Director of Engineering, SC), `james-obi` (Senior Product Manager, JO), `dev-patel` (Engineering Lead, DP), `anna-mueller` (Product Manager, AM)
    - 5 motivation types with hand-crafted JSON Schema 2020-12 attribute_schemas and scoring formulas:
        1. **Customer Demand** — schema with customer_name (string), segment (enum), strategic_flag (boolean), revenue_at_risk (number), revenue_opportunity (number), deal_stage (enum), target_date (date format), impact_type (enum), confidence (number, min 0, max 1). Formula: `(revenue_at_risk * date_urgency(target_date) * confidence) + (revenue_opportunity * strategic_weight(strategic_flag) * confidence)`
        2. **Compliance / Regulatory** — schema with regulation (string), mandate_deadline (date), penalty_severity (enum), legal_exposure (number), confidence (number). Formula: `legal_exposure * date_urgency(mandate_deadline) * severity_weight(penalty_severity) * confidence`
        3. **Tech Debt** — schema with incident_frequency (number), performance_impact (enum), blast_radius (enum), support_hours_monthly (number), architectural_risk (enum). Formula: `(incident_frequency * blast_radius_weight(blast_radius)) + (support_hours_monthly * 10) + severity_weight(performance_impact) * severity_weight(architectural_risk)`
        4. **Internal Mandate** — schema with stakeholder (string), mandate_type (enum), target_date (date), business_justification (string), priority_override (enum). Formula: `override_weight(priority_override) * date_urgency(target_date)`
        5. **Competitive Gap** — schema with competitor (string), gap_severity (enum), deals_lost (number), market_segment (string), confidence (number). Formula: `deals_lost * gap_weight(gap_severity) * confidence`
- [ ] Each attribute_schema is a valid JSON Schema 2020-12 document with `additionalProperties: false`, enum values defined inline, format validators for dates
- [ ] Seed runs on server start if motivation_types table is empty
- [ ] Verify: `SELECT * FROM motivation_types` returns 5 rows, schemas parse with ajv

### Step 4: Mock Auth Middleware

- [ ] `api/src/middleware/auth.ts`
    - Reads `X-User-Id` header (case-insensitive)
    - Looks up user in users table
    - Missing header → 401 `{error: {code: "UNAUTHORIZED", message: "X-User-Id header required"}}`
    - Invalid user → 401 `{error: {code: "UNAUTHORIZED", message: "Unknown user: <id>"}}`
    - Attaches user to `req.user` for downstream handlers (extend Express Request type in shared/)
    - GET requests bypass auth (for future shareable URLs)
    - Applied to all routes via `app.use(authMiddleware)`
- [ ] Verify: POST without header → 401, POST with `X-User-Id: sarah-chen` → proceeds, GET without header → proceeds

### Step 5: JSONB Validation

- [ ] `api/src/lib/validate.ts`
    - Import `Ajv2020` from `ajv/dist/2020` (critical — default import uses draft-07)
    - Add formats via `ajv-formats` (for `date` format on target_date fields)
    - `allErrors: true` so all validation errors are reported, not just the first
    - Compile and cache validators per motivation type ID (ajv auto-caches by schema object)
    - `validateAttributes(typeId, attributes)` — fetches type schema, validates, returns result
    - Returns `{valid: true}` or `{valid: false, errors: [{field: string, message: string}]}`
    - Field extraction: `required` errors → `params.missingProperty`, `additionalProperties` → `params.additionalProperty`, others → `instancePath` converted to dot notation
    - Unknown properties rejected (`additionalProperties: false` in all schemas)
- [ ] Verify: valid attributes pass, missing required field returns field-level error, extra field returns "additional properties" error, invalid enum value returns allowed values in message

### Step 6: History Helper

- [ ] `api/src/lib/diff.ts`
    - Uses **microdiff** for deep object comparison
    - `flatDiff(oldObj, newObj)` — returns `Record<string, {old: unknown, new: unknown}>`
    - Converts microdiff's `path` arrays to dotted keys (e.g. `["attributes", "revenue_at_risk"]` → `"attributes.revenue_at_risk"`)
    - CREATE type → `{old: null, new: value}`, REMOVE → `{old: value, new: null}`, CHANGE → `{old: oldValue, new: value}`
    - For entity creation (no old object): produces diff from empty object showing all fields as null → value
- [ ] `api/src/lib/history.ts`
    - `recordHistory(entityType, entityId, changeType, changes, userId)` — inserts into history table
    - `recordCreate(entityType, entity, userId)` — diffs from `{}` to capture all initial field values
    - `recordUpdate(entityType, entityId, oldEntity, newEntity, userId)` — computes deep diff, only records if changes exist
    - `recordLink(outcomeId, motivationId, userId)` — records linked event for both entities
    - `recordUnlink(outcomeId, motivationId, userId)` — records unlinked event for both entities
    - Called explicitly from route handlers (not Express middleware — needs before/after state)
- [ ] Verify: update a motivation's attributes.revenue_at_risk, query history, see `{"attributes.revenue_at_risk": {"old": 100000, "new": 200000}}`

### Step 7: Core API Routes

All routes follow the same pattern: validate input, perform operation, record history, broadcast SSE event, return response.

**Outcomes** — `api/src/routes/outcomes.ts`
- [ ] `POST /outcomes` — create with title (required), optional description, effort, milestone_id, status (default: draft), pinned (default: false), tags[]. Tags handled as: create outcome → bulk insert outcome_tags. Record history (created). Return 201.
- [ ] `GET /outcomes` — list with pagination (?limit, ?offset). Filter by ?status, ?tags (AND logic via relational division), ?motivation_type (outcomes with at least one motivation of that type). Sort by pinned DESC, priority_score DESC, created_at DESC. Include derived fields: motivation_count (`COUNT` from join), motivation_type_summary (aggregated from joins), earliest_critical_date (MIN of date attributes from linked motivations).
- [ ] `GET /outcomes/:id` — single outcome with all fields + linked motivations (with their type and score), tags, VE links, comments (latest 3).
- [ ] `PUT /outcomes/:id` — full update. Fetch old state first for diff. Validate effort/status against allowed values. Handle tag changes (diff old vs new, insert/delete as needed). Record history (updated, deep diff). Recalculate priority if effort changed. Return 200.
- [ ] `PATCH /outcomes/:id/pin` — toggle pinned boolean. Record history (pinned/unpinned). Return 200.
- [ ] `DELETE /outcomes/:id` — hard delete. CASCADE handles cleanup. Record history (deleted) before deleting. Return 204.

**Motivations** — `api/src/routes/motivations.ts`
- [ ] `POST /motivations` — create with title (required), type_id (required), optional attributes (validated via ajv), notes, status (default: active), tags[]. Compute initial score via filtrex evaluator. Record history (created). Return 201.
- [ ] `GET /motivations` — list with pagination. Filter by ?type, ?tags (AND), ?status. Sort by score DESC. Include linked_outcome_count, human_readable_summary (generated from attributes).
- [ ] `GET /motivations/:id` — single motivation with all fields + linked outcomes (id, title, priority_score, status), tags.
- [ ] `PUT /motivations/:id` — update. Validate attributes against type schema. Recompute score. Record history. Recalculate priority on all linked outcomes. Return 200.
- [ ] `PATCH /motivations/:id/resolve` — set status to resolved, zero the score. Record history (resolved). Recalculate linked outcomes. Return 200.
- [ ] `PATCH /motivations/:id/reopen` — set status to active, recompute score. Record history (reopened). Recalculate linked outcomes. Return 200.
- [ ] `POST /motivations/:id/link/:outcomeId` — create outcome_motivation row. Record history (linked) on both. Recalculate outcome priority. Return 201.
- [ ] `DELETE /motivations/:id/link/:outcomeId` — remove row. Record history (unlinked). Recalculate outcome. Return 204.

**Milestones** — `api/src/routes/milestones.ts`
- [ ] `POST /milestones` — create. Record history. Return 201.
- [ ] `GET /milestones` — list with pagination. Include derived: outcome_count, effort_summary (tally per t-shirt size via aggregation on linked outcomes).
- [ ] `GET /milestones/:id` — single milestone with linked outcomes (sorted by priority_score DESC).
- [ ] `PUT /milestones/:id` — update. Record history. Return 200.
- [ ] `DELETE /milestones/:id` — delete. SET NULL on outcomes.milestone_id (handled by FK). Record history. Return 204.

**Tags** — `api/src/routes/tags.ts`
- [ ] `POST /tags` — create. Check case-insensitive uniqueness before insert. Validate colour as `#RRGGBB`. Return 201.
- [ ] `GET /tags` — list all (no pagination — tags are few). Include usage_count (SUM of outcome_tags + motivation_tags + milestone_tags via subqueries or UNION).
- [ ] `PUT /tags/:id` — update. Record history. Return 200.
- [ ] `DELETE /tags/:id` — delete. CASCADE removes join table rows. Return 204.

**ValueEdge Links** — nested under outcomes
- [ ] `POST /outcomes/:id/valueedge-links` — create link with entity_type (validated), entity_id, optional url. Record history. Return 201.
- [ ] `DELETE /valueedge-links/:id` — delete link. Record history. Return 204.

**Comments** — `api/src/routes/comments.ts`
- [ ] `POST /outcomes/:id/comments` — create comment (body required). Append-only, no edit/delete. Return 201.
- [ ] `GET /outcomes/:id/comments` — list with pagination (limit, offset). Newest first.

**History** — `api/src/routes/history.ts`
- [ ] `GET /outcomes/:id/history` — paginated history. Uses index on (entity_type, entity_id, changed_at DESC).
- [ ] `GET /motivations/:id/history` — paginated history.

### Step 8: Scoring Engine

The core value proposition — automated priority ranking. Uses **filtrex** for safe formula evaluation.

- [ ] `api/src/scoring/functions.ts` — built-in scoring functions registered with filtrex:
    - `date_urgency(dateStr)` → parse date, compute days until. >90d=0.2, 30-90=0.5, 7-30=0.8, <7=1.0, overdue=1.2. Handle null/missing → return 0.
    - `severity_weight(level)` → critical=1.0, high=0.7, medium=0.4, low=0.1. Handle unknown → 0.
    - `strategic_weight(flag)` → truthy=1.5, falsy=1.0
    - `override_weight(level)` → same mapping as severity_weight
    - `blast_radius_weight(level)` → platform-wide=1.0, service=0.6, component=0.3
    - `gap_weight(level)` → table-stakes=1.0, differentiator=0.6, nice-to-have=0.2
- [ ] `api/src/scoring/evaluator.ts` — filtrex-based formula evaluator:
    - `compileFormula(formulaStr)` — calls `compileExpression(formula, { extraFunctions })`, caches compiled function by formula string
    - `evaluateScore(formula, attributes)` — compiles (or retrieves from cache), evaluates against attributes object, returns numeric score
    - Handle missing/null attributes gracefully — filtrex resolves undefined variables as `undefined`, scoring functions treat as 0
    - Handle evaluation errors — return 0 and log warning (don't crash on bad formula)
- [ ] `api/src/scoring/recalculate.ts`:
    - `recalculateMotivation(id)` — load motivation + type, evaluate formula against attributes, update score column
    - `recalculateOutcome(id)` — SUM scores of linked active (not resolved) motivations, subtract effort_penalty, update priority_score
    - `recalculateAll()` — batch: load all motivation types, recalculate all motivations, then recalculate all outcomes. Use transactions for consistency.
    - Effort penalty map: `{XS: 0, S: 50, M: 150, L: 300, XL: 500, null: 0}`
- [ ] Wire scoring into motivation create/update — auto-compute score after save
- [ ] Wire scoring into link/unlink — recalculate affected outcome's priority
- [ ] Wire scoring into motivation resolve/reopen — recalculate all linked outcomes
- [ ] `POST /scoring/recalculate` — manual trigger for batch recalculation (auth required)
- [ ] `GET /outcomes/:id/score` — score breakdown: list each linked motivation with its title, type, score, and human-readable summary. Show effort penalty. Show final priority_score.
- [ ] `node-cron` schedule: `cron.schedule('0 0 * * *', recalculateAll)` — daily at midnight for date-based urgency updates
- [ ] Verify: create Customer Demand motivation with revenue_at_risk=1000000, target_date=14 days from now, confidence=0.9 → score computed. Link to outcome with effort=M → priority_score = motivation_score - 150.

#### Research Insights: filtrex

```typescript
import { compileExpression } from "filtrex";

// Compile once, evaluate many times
const scoreFn = compileExpression(
  "(revenue_at_risk * date_urgency(target_date) * confidence) + (revenue_opportunity * strategic_weight(strategic_flag) * confidence)",
  { extraFunctions: { date_urgency, strategic_weight } }
);

const score = scoreFn(motivationAttributes); // returns number
```

- Compiles to a native JS function — 100K evaluations in ~20ms
- Provably sandboxed — no prototype access, no loops, no escape
- Missing variables resolve to `undefined` (handle in scoring functions)
- 12kb gzipped, zero dependencies
- **Do NOT use expr-eval** — CVE-2025-12735 (prototype pollution / RCE)

### Step 9: SSE Foundation

Lightweight event streaming. Raw implementation, no library.

- [ ] `api/src/sse/emitter.ts`:
    - `clients` Set of connected Response objects
    - `broadcast(event)` — iterate clients, `res.write(\`data: \${JSON.stringify(event)}\n\n\`)`
    - Event shape: `{type: "outcome_updated" | "outcome_created" | "outcome_deleted" | "motivation_updated" | "motivation_created" | "motivation_resolved" | "milestone_updated" | "link_created" | "link_deleted" | ..., id: string, timestamp: string}`
    - Keep-alive ping every 30s: `res.write(": keep-alive\n\n")` — colon prefix is SSE comment, ignored by EventSource
- [ ] `GET /events` — SSE endpoint:
    - Set headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
    - Call `res.flushHeaders()`
    - Add res to clients Set
    - `req.on("close", () => clients.delete(res))`
    - If using compression middleware, call `res.flush()` after each write
- [ ] Wire broadcasts into route handlers — emit after successful mutations
- [ ] Verify: `curl -N http://localhost:3000/events`, create an outcome in another terminal, see `data: {"type":"outcome_created","id":"..."}` arrive

---

## Acceptance Criteria

- [ ] `docker compose up` starts PostgreSQL + API server, healthcheck passes
- [ ] 5 motivation types seeded with valid JSON Schema 2020-12 attribute_schemas and scoring formulas
- [ ] 4 mock users seeded and switchable via X-User-Id header
- [ ] Full CRUD for outcomes, milestones, tags
- [ ] Create/read/update/resolve/reopen for motivations (no hard delete)
- [ ] Link/unlink motivations to outcomes
- [ ] JSONB attributes validated against motivation type schema on create and update (ajv)
- [ ] Scoring: motivation scores computed from formulas (filtrex), outcome priority computed from linked active motivations minus effort penalty
- [ ] Daily cron recalculates date-based scores
- [ ] Audit history recorded for all mutations with deep field-level diffs (microdiff)
- [ ] Comments on outcomes (append-only)
- [ ] ValueEdge links on outcomes
- [ ] Pagination on all list endpoints (default 50, max 100)
- [ ] Tag filtering with AND logic
- [ ] SSE endpoint streaming entity change events
- [ ] All endpoints return consistent response format (201/200/204 on success, 400/401/404 on error)
- [ ] Graceful shutdown on SIGTERM/SIGINT

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| express | 5.2.x | HTTP server |
| drizzle-orm | 0.39.x | ORM (install in api/ only) |
| drizzle-kit | 0.31.x | Migrations |
| pg | 8.x | PostgreSQL driver |
| filtrex | 3.1.x | Formula evaluation |
| microdiff | latest | Deep object diffing |
| ajv | latest | JSON Schema validation (import from ajv/dist/2020) |
| ajv-formats | latest | Date/email format validators |
| cors | latest | CORS middleware |
| node-cron | latest | Daily score recalculation |
| tsx | 4.21.x | Dev runner with watch mode |
| typescript | 5.7.x | Compiler |

Runtime: Node.js 22 LTS, PostgreSQL 16.

## Risks

| Risk | Mitigation |
|------|------------|
| Formula evaluator complexity | filtrex handles parsing + sandboxing. We only write scoring functions. Compile-once, evaluate-many pattern. |
| JSONB validation edge cases | ajv is battle-tested. Hand-craft all 5 schemas. Test each with valid + invalid data + extra fields. |
| History table growth | Append-only by design. Composite index on (entity_type, entity_id, changed_at DESC) for fast paginated reads. Consider partial index on active entity_types if needed. |
| Deep JSONB diffing | microdiff handles all cases (create/change/remove). Motivation attributes are flat key-value — no deep nesting to worry about. |
| Drizzle count() returns string | Cast to int in all aggregation queries: `sql<number>\`cast(count(*) as int)\`` |
| Duplicate drizzle-orm instances | Install drizzle-orm ONLY in api/ workspace. shared/ imports types only, not the ORM. |

## Sources

- **Origin:** [docs/PLAN.md](../PLAN.md) — Phase 1 definition, tech stack
- **Spec:** [docs/SPEC.md](../SPEC.md) — domain model, scoring system, API endpoints
- **Decisions:** [docs/DECISIONS.md](../DECISIONS.md) — ADR-001 through ADR-010
- **Drizzle ORM docs:** https://orm.drizzle.team/docs
- **filtrex:** https://github.com/cshaa/filtrex — formula evaluation
- **microdiff:** https://github.com/AsyncBanana/microdiff — deep diffing
- **ajv JSON Schema 2020-12:** https://ajv.js.org/ — import from `ajv/dist/2020`
- **Express 5:** https://expressjs.com/
- **CVE-2025-12735:** https://nvd.nist.gov/vuln/detail/CVE-2025-12735 — expr-eval RCE (do not use)
