# 🐄 moou

Outcome-based prioritisation system for product and engineering teams.

moou captures **what** to build and **why**, automatically ranking outcomes by the motivations behind them — customer demands, compliance deadlines, tech debt, competitive gaps, and internal mandates.

It sits upstream of your ticket management system (ValueEdge, GitHub Issues, Jira, Linear) and feeds approved, prioritised outcomes into execution.

## How it works

1. **Create outcomes** — features, improvements, migrations you want to achieve
2. **Attach motivations** — the reasons behind each outcome (customer need, compliance deadline, tech debt)
3. **Scores compute automatically** — each motivation type has a scoring formula that weighs revenue, urgency, confidence, severity
4. **Priorities surface** — outcomes rank by the sum of their motivation scores, adjusted by effort
5. **Dates matter** — urgency increases automatically as deadlines approach
6. **Motivations are shared** — one customer demand can motivate multiple outcomes, keeping the picture connected

## Quick start

```bash
# Prerequisites: Docker, Node.js 20+

# Clone and install
git clone <repo-url> && cd moou
npm install

# Start PostgreSQL
docker compose up db -d

# Push schema and start API
cd api && npx drizzle-kit push && cd ..
DATABASE_URL=postgresql://moou:moou@localhost:5432/moou npx tsx api/src/index.ts

# In another terminal, start the frontend
npm run dev --workspace=app
```

Open http://localhost:5173 (or 5174). The walkthrough will guide you through the app on first visit.

## Features

### Timeline
Default landing view. Outcomes grouped by milestone (releases, deadlines, reviews) with a backlog sidebar. Export as Excel or Markdown, import modified spreadsheets with interactive diff review.

### Outcomes
Ranked list sorted by priority score. Filter by tags, status, motivation type. Search across titles and descriptions. Create, edit, pin, archive, delete.

### Motivations
Shared entities representing reasons to build something. Five built-in types with typed attributes and scoring formulas:

| Type | Attributes | What it scores |
|------|-----------|----------------|
| **Customer Demand** | customer, revenue at risk, deal stage, target date, confidence | Revenue × urgency × confidence |
| **Compliance** | regulation, deadline, penalty severity, legal exposure | Exposure × urgency × severity |
| **Tech Debt** | incident frequency, blast radius, support hours, architectural risk | Incidents + support cost + severity |
| **Internal Mandate** | stakeholder, mandate type, target date, priority override | Override weight × urgency |
| **Competitive Gap** | competitor, gap severity, deals lost, confidence | Deals lost × gap weight |

### Date mismatch detection
Red/amber indicators warn when a motivation's target date is before its outcome's milestone date. Visible across all views — timeline cards, outcome list, motivation list, and detail panels.

### Export / Import
Export the timeline as Excel (one sheet per milestone, outcomes with merged cells, motivations as individual rows with typed attributes) or Markdown. Import a modified spreadsheet — moou detects changes to outcomes and motivation attributes, and lets you selectively apply them.

### Pluggable external systems
Link outcomes to your ticket management system. Configure one provider per deployment (ValueEdge, GitHub, Jira, Linear). Entity types are validated against the provider. Links are just URLs — paste and go.

## Project structure

```
moou/
├── app/                    # Vue 3 + TypeScript + Vite frontend
│   ├── src/views/          # Timeline, Outcomes, Motivations views
│   ├── src/components/     # Detail panels, forms, TagPicker, Walkthrough
│   └── src/composables/    # useApi, useSSE, useDateMismatch
├── api/                    # Express 5 + TypeScript backend
│   ├── src/routes/         # REST API routes
│   ├── src/scoring/        # Formula evaluator (filtrex), recalculation
│   ├── src/db/             # Drizzle schema, migrations, seed data
│   └── src/sse/            # Server-sent events for real-time updates
├── shared/                 # Shared TypeScript types
├── docs/
│   ├── SPEC.md             # Full product specification
│   ├── DECISIONS.md        # Architecture decision records (13 ADRs)
│   ├── PLAN.md             # Implementation plan with phases
│   └── mockup.html         # Interactive HTML/CSS mockup
├── docker-compose.yml      # PostgreSQL + app containers
└── Dockerfile              # Multi-stage build
```

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vue 3 + TypeScript + Vite | SFCs, built-in reactivity for SSE updates |
| Styling | CSS variables + scoped styles | Design system from mockup, no framework needed |
| Backend | Express 5 + TypeScript | Same language as frontend, async error handling |
| Database | PostgreSQL 16 | JSONB for typed motivation attributes |
| ORM | Drizzle | Type-safe, lightweight |
| Scoring | filtrex | Safe formula evaluation with custom functions |
| Real-time | SSE | Entity change events pushed to connected clients |
| Diffing | microdiff | Deep JSONB diffs for audit trail |
| Validation | ajv | JSON Schema 2020-12 for motivation attributes |
| Export | exceljs | Excel spreadsheet generation and parsing |

## Testing

```bash
# Backend tests (unit + integration, needs PostgreSQL running)
npm run test --workspace=api

# Frontend tests (component tests, no server needed)
npm run test --workspace=app
```

121 tests across both packages covering scoring functions, formula evaluation, API routes, Vue components, SSE composable, date mismatch detection, and export/import.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `PORT` | 3000 | API server port |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:5174` | Allowed origins for CORS |
| `EXTERNAL_PROVIDER` | `valueedge` | Ticket system provider (`valueedge`, `github`, `jira`, `linear`) |

## Mock users (development)

| Name | Role | ID |
|---|---|---|
| Sarah Chen | Director of Engineering | `sarah-chen` |
| James Obi | Senior Product Manager | `james-obi` |
| Dev Patel | Engineering Lead | `dev-patel` |
| Anna Müller | Product Manager | `anna-mueller` |

Switchable via the user dropdown in the top-right. Set via `X-User-Id` header on API requests.

## Documents

| Document | What's in it |
|----------|-------------|
| [docs/SPEC.md](docs/SPEC.md) | Domain model, scoring system, UI design, personas, v1/v2 scope |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 13 architecture decision records with rationale |
| [docs/PLAN.md](docs/PLAN.md) | Build phases, tech stack choices, testing strategy |
| [docs/mockup.html](docs/mockup.html) | Interactive UI mockup (open in browser) |
