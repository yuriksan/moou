# moou — AI Agent Instructions

## Project overview

moou is a product outcomes tool. Backend: Node.js/Express + TypeScript in `api/`. Frontend: Vue 3 + Vite in `app/`. Database: PostgreSQL via Drizzle ORM. Deployed with Docker Compose.

## Build & deploy

```bash
npm run build && docker compose up -d --build
```

TypeScript is compiled from `api/` (tsc) and `app/` (vite build) before the Docker image is built.

## Key design: provider adapter pattern

moou integrates with external issue trackers (ValueEdge, GitHub, …) through a swappable adapter.

**BLOCKING REQUIREMENT:** Before touching any provider, adapter, or integration-related code, read `.copilot/skills/provider-adapter/SKILL.md` in full. It contains mandatory rules — including the provider-agnosticism invariant and auth error propagation contract — that must be followed.

**The most important invariant:** `ProviderAuthError` (defined in `api/src/providers/adapter.ts`) must never be silently swallowed. Expired tokens must surface to the user — via HTTP 401 for synchronous routes, or via `session_expired` SSE broadcast for fire-and-forget paths.

## Architecture decisions

See `docs/DECISIONS.md` for recorded architecture decisions.  
See `docs/INTEGRATIONS.md` for the full provider integration guide.

## Conventions

- All imports use `.js` extensions (ESM, Node 18+).
- `api/` uses strict TypeScript — no implicit `any`.
- Routes never import provider-specific code directly; always go through `getAdapter()`.
- Database access only in `api/src/db/` and route files; never in adapters.
