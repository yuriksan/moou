# Implementation Plan

## Status: Ready to build

Built solo with Claude. Optimised for minimal moving parts and fast iteration.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Frontend** | Vue 3 + TypeScript + Vite | SFCs keep template/logic/style together. Built-in reactivity handles SSE updates naturally. Less boilerplate than React. |
| **Styling** | CSS variables + Vue scoped styles | Design language already defined in the mockup. No framework needed — variables for theming, scoped styles for components. |
| **Backend** | Node + Express + TypeScript | Same language as frontend. Shared types across the monorepo. Express is minimal and well-understood. |
| **Database** | PostgreSQL | JSONB for motivation type-specific attributes. Solid relational model for the core entities. |
| **ORM** | Drizzle | Type-safe, lightweight, good PostgreSQL support. Schema defined in TypeScript. |
| **SSE** | Express + in-process EventEmitter | Entity mutation → emit event → stream to connected clients. No pub/sub infrastructure needed for single-process deployment. |
| **Background jobs** | node-cron | In-process cron for daily score recalculation. `cron.schedule('0 0 * * *', recalculateScores)`. No Redis. |
| **Deployment** | docker-compose | Two containers: app (API + built frontend static files) and PostgreSQL. |

### Project Structure

```
moou/
├── app/                    # Vue frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── views/          # Timeline, Outcomes, Motivations views
│   │   ├── composables/    # Shared logic (SSE, filters, auth)
│   │   └── types/          # Shared TypeScript types
│   └── vite.config.ts
├── api/                    # Express backend
│   ├── src/
│   │   ├── routes/         # Express route handlers
│   │   ├── db/             # Drizzle schema + migrations
│   │   ├── scoring/        # Formula evaluator + recalculation
│   │   ├── sse/            # SSE event emitter + endpoint
│   │   ├── auth/           # Mock auth middleware
│   │   └── history/        # Audit trail recording
│   └── seed/               # Built-in motivation types + mock users
├── shared/                 # TypeScript types shared between app and api
├── docker-compose.yml
├── Dockerfile
├── SPEC.md
├── DECISIONS.md
└── PLAN.md
```

---

## Build Order

### Phase 1: Foundation

Get data in and out. No UI yet — test with curl or a REST client.

1. **Project scaffolding** — monorepo structure, TypeScript config, docker-compose with PG
2. **Database schema** — Drizzle schema for all entities, join tables, history
3. **Seed data** — 5 built-in motivation types with attribute schemas and scoring formulas, 4 mock users
4. **Core API routes** — CRUD for outcomes, motivations, milestones, tags. Linking/unlinking. External links. Comments. History.
5. **Mock auth middleware** — reads X-User-Id header, 401 on missing/invalid, GET bypass
6. **Audit history** — microdiff-based field-level diffs on every mutation
7. **Scoring engine** — filtrex formula evaluator, built-in functions, recalculation, node-cron daily job
8. **SSE foundation** — event streaming endpoint with broadcasts wired into mutations
9. **Unit tests** — scoring functions, formula evaluator, deep diff, effort penalty (vitest)

**Testing:** Unit tests for scoring functions (all 6 built-in functions), formula evaluator (all 5 motivation type formulas), deep diff utility, and effort penalty mapping. No DB required.

**Done when:** All API endpoints functional, scoring computes correctly, SSE streams events, 36+ unit tests pass.

### Phase 2: API Integration Tests

Verify the API works end-to-end with a real database.

1. **Test database setup** — docker-compose test profile or in-memory PG via `pg-mem`
2. **Outcome lifecycle** — create, update, pin, delete, verify history recorded
3. **Motivation lifecycle** — create with attributes (validated), update, resolve, reopen, verify score changes
4. **Linking** — link/unlink motivation to outcome, verify outcome priority recalculates
5. **Tag filtering** — create tagged outcomes, verify AND filter logic
6. **Milestone aggregation** — create milestone with outcomes, verify effort summary
7. **Auth** — verify 401 on missing header, GET bypass, invalid user

**Testing:** Integration tests with real DB. Each test seeds its own data, tests the full request→DB→response cycle.

**Done when:** All API routes tested with real database, including error cases and edge cases.

### Phase 3: Timeline View

The default landing page. Get this right first since it's what users see.

1. **Vue app scaffolding** — Vite project, router, CSS variables from mockup design
2. **API client** — typed fetch wrapper for all endpoints
3. **SSE composable** — `useSSE()` that connects to the event stream and provides reactive state
4. **Timeline view** — backlog sidebar + milestone sections with outcome cards
5. **Milestone CRUD** — create/edit/delete milestones from the timeline
6. **Outcome detail panel** — slides in from right, shows description, score breakdown, linked motivations, external links, comments, history
7. **Drag-and-drop** — drag outcomes between milestones and from backlog

**Testing:** Component tests (vitest + @vue/test-utils) for: timeline layout rendering, milestone section grouping, backlog filtering, detail panel open/close, SSE composable (mocked EventSource). Test the API client with mocked fetch.

**Done when:** Timeline view functional with component tests. Can view, create milestones, see grouped outcomes, click detail, drag to reassign.

### Phase 4: Outcomes + Motivations Views

The other two navigation paths.

1. **Outcomes view** — ranked list with summary strip, filters (tags, status, motivation type), search
2. **Motivations view** — grouped by type, filters, sort options
3. **Motivation detail panel** — type/attributes form, score, linked outcomes, history
4. **Cross-navigation** — outcome → motivation → other outcomes (and vice versa)
5. **Tag filtering** — shared filter bar across all views, clickable tags
6. **Search** — full-text search bar in top nav

**Testing:** Component tests for: outcome/motivation list rendering with mock data, filter composable logic (tag AND, status, type), summary strip computed values, search results grouping. Cross-navigation is tested by verifying router pushes on card clicks.

**Done when:** All three views work with filtering, detail panels, cross-navigation. Component tests pass.

### Phase 5: Collaboration + Polish

CRUD forms, SSE-driven live updates, and remaining features.

1. **Create/edit outcome** — OutcomeForm component, reusable for create and edit. Available from Timeline (+ Outcome) and Outcomes view. Edit mode in detail panel. Delete with confirmation. DONE
2. **Create motivation + link** — MotivationForm with progressive disclosure (title + type first, expand for attributes). Auto-links to outcome. DONE
3. **Link/unlink motivations** — search existing motivations to link, unlink button on each card. DONE
4. **SSE broadcasting** — API mutations emit events, connected clients refetch. DONE (wired in Phase 1)
5. **Reactive UI updates** — SSE events trigger data refetch in all views. DONE
6. **Comments** — create/list on outcome detail. DONE
7. **Motivation resolve/reopen** — status toggle in detail panel. DONE
8. **Pin/unpin outcomes** — in detail panel header. DONE
9. **Tag inline creation** — TagPicker component with inline creation (name, emoji, colour). DONE
10. **External link management** — add/remove links from outcome detail, entity type validated against configured provider. DONE
11. **Progressive disclosure** — motivation creation form shows title + type first, expand for details. DONE
12. **Creator attribution** — shown in detail headers. PARTIAL (createdBy field displayed, no avatars yet)
13. **Export/import timeline** — Excel export with right-joined motivation rows, Markdown export, import with diff detection and selective apply. DONE
14. **Tag admin** — rename, edit, delete with usage counts. Accessible via ⚙ button. DONE
15. **Shareable URLs** — filter state encoded in URL params. Outcomes and Motivations views sync filters to/from URL. DONE
16. **Full-text search** — GET /search?q=term across outcomes, motivations, tags. Search bar in topbar with dropdown results. DONE

**Testing:** Component tests for OutcomeForm, MotivationForm, TagPicker. Integration tests for full CRUD flow.

**Done when:** Users can create, edit, link, and score outcomes and motivations through the UI. SSE pushes updates to other connected clients.

### Phase 6: Deployment

1. **Dockerfile** — multi-stage build (build frontend, bundle with API)
2. **docker-compose.yml** — app + PostgreSQL
3. **Environment config** — database URL, mock users, port
4. **Seed script** — run on first boot to populate motivation types and mock users

**Testing:** Smoke test the Docker build: `docker compose up`, verify healthcheck, create an outcome via curl, verify SSE event arrives. This is a manual checklist, not automated.

---

## Mock Users (for development)

| Name | Role | Avatar |
|---|---|---|
| Sarah Chen | Director of Engineering | SC |
| James Obi | Senior Product Manager | JO |
| Dev Patel | Engineering Lead | DP |
| Anna Müller | Product Manager | AM |

Switchable via a dropdown in the top nav (dev only). Selected user is sent in request headers for audit trail attribution.

---

## What's Not in v1

See SPEC.md "Non-Goals (v1)" and "V2+" sections. Key deferrals:
- Block-based rich text editor → markdown in v1
- Fragment-to-external-system mapping → manual link entry in v1
- Split UI → manual outcome creation + re-linking in v1
- Motivation type admin UI → seed data config in v1
- Enhanced timeline/dashboard → basic versions ship in v1
- Bulk operations
- Onboarding flow
