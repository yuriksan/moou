# Role-Based Authentication — Implementation Plan

## Status: Awaiting approval

Companion to `docs/ROLE_BASED_AUTH.md`. Read the spec first — this plan is ordering and file-level detail only.

## Phase 1 — Schema & migration

**Files**
- `api/src/db/schema.ts:13-21` — rename `role` → `jobTitle`; add new `role` (text + CHECK constraint), `status` (text + CHECK), `email`, `createdAt`, `createdBy`, `lastLoginAt`; add `user_audit_log` table.
- `api/drizzle/` — `drizzle-kit generate` produces a new migration.
- `api/src/db/seed.ts:6-11` — update to populate both `jobTitle` and `role`.

**Steps**
1. Add new columns as nullable (migration A).
2. Backfill in migration B:
   - `jobTitle = old role`.
   - `role = 'admin'` where `id IN (ADMIN_USERS)`; `role = 'modifier'` elsewhere.
3. Apply NOT NULL + CHECK constraints in migration C.
4. Update seed to match new shape.

**Exit**: `npm run build` passes; migrations apply cleanly against a fresh DB and against a DB restored from a pre-migration snapshot.

## Phase 2 — Admin bootstrap

**Files**
- `api/src/app.ts` — before `app.listen`, call new `reconcileConfiguredAdmins()`.
- `api/src/auth/configured-admins.ts` (new) — parse `ADMIN_USERS`, upsert stubs, export in-memory `configuredAdminIds: Set<string>`.

**Steps**
1. Parse `ADMIN_USERS` at boot; validate each token matches `<provider>:<id>` and provider matches `EXTERNAL_PROVIDER`.
2. Upsert `users` rows with `role='admin'`, `status='active'`.
3. Fail startup with a clear error if no valid entries exist for the active provider.

**Exit**: unit test covers: empty env var (fails), mismatched provider (ignored + warning), valid multi-entry (upserts).

## Phase 3 — Login gate & middleware

**Files**
- `api/src/auth/github.ts:127-148` — remove auto-create; read user, deny if missing/revoked.
- `api/src/auth/valueedge.ts:167-173` — same as GitHub.
- `api/src/middleware/auth.ts:34-93` — reject `status='revoked'` on every request.
- `api/src/middleware/authorize.ts` (new) — `requireRole`, `requireWrite`, `requireAdmin`.

**Steps**
1. Implement login-gate logic in both OAuth callbacks. Emit `ACCESS_DENIED` redirect param on deny.
2. Middleware-level status recheck; emit 401 with `error: 'ACCESS_REVOKED'`.
3. Apply `requireWrite` to every mutation route. Audit list: tag CRUD (`api/src/routes/tags.ts`), milestone CRUD, outcome CRUD, comment CRUD, field-config CRUD (replace inline check at `api/src/routes/backend.ts:275-320`).

**Exit**: integration tests: user with no row gets `ACCESS_DENIED`, revoked user gets 401 mid-session, viewer gets 403 on write routes, modifier can write but not hit admin routes.

## Phase 4 — User management API

**Files**
- `api/src/routes/admin-users.ts` (new) — all seven endpoints from spec §7.
- `api/src/app.ts` — mount under `/api/admin/users`.

**Steps**
1. Implement list with cursor pagination, `q`, `role`, `status` filters.
2. Implement POST, PATCH, revoke, restore with guard rails (`CANNOT_MODIFY_SELF`, `CONFIGURED_ADMIN_IMMUTABLE`).
3. Every mutation writes `user_audit_log` row.
4. Add `express-rate-limit` instance scoped per-admin for `/api/admin/directory` (implemented in phase 5).

**Exit**: API tests cover each endpoint's happy path + every guard rail error.

## Phase 5 — Provider adapter: `searchDirectory`

**Files**
- `api/src/providers/adapter.ts:44-80` — extend `ProviderAdapter` interface.
- `api/src/providers/github-adapter.ts` — implement via GitHub `/search/users`.
- `api/src/providers/valueedge-adapter.ts` — implement via workspace users endpoint.
- `api/src/routes/admin-users.ts` — add `GET /api/admin/directory` that calls `getAdapter().searchDirectory(...)`.

**Steps**
1. Add interface method + provider-user type.
2. GitHub implementation + in-process per-query cache (60s).
3. ValueEdge implementation, workspace-scoped.
4. Route handler catches `ProviderAuthError` → 401 (spec §8).

**Exit**: adapter tests with mocked HTTP verify auth-error propagation and result shape for each provider.

## Phase 6 — Frontend auth state & guards

**Files**
- `app/src/composables/useAuth.ts` (new) — `currentUser`, `isAdmin`, `canWrite`.
- `app/src/App.vue:77-91` — populate `currentUser` from `/api/me`; wire header chip.
- `app/src/App.vue:25-47` — `v-if="isAdmin"` on admin dropdown.
- `app/src/router/index.ts` — `beforeEach` guard reading `meta.requiresRole`.
- `app/src/composables/useApi.ts:64-67` — add 403 `ROLE_CHANGED` handler.
- `app/src/views/LoginView.vue:100-103` — render `ACCESS_DENIED` message.

**Exit**: manual check in dev with three users (admin, modifier, viewer) — admin nav visible only to admin; guard redirects modifier/viewer from `/admin/*`.

## Phase 7 — UI treatment pass

**Files** (non-exhaustive — follow table in spec §9.4)
- Timeline/backlog views: hide inline row actions, bulk checkboxes for viewers.
- Milestone/outcome detail forms: read-only fields + hide save for viewers.
- Comment composer components: swap for muted note.
- Primary "New …" buttons: `:disabled="!canWrite"` + tooltip.
- Tag/status/assignee inline pickers: static badge when `!canWrite`.

**Exit**: walk through app as each role via mock provider; no write affordance is clickable for a viewer, no ghost admin nav visible to modifier/viewer.

## Phase 8 — User admin view

**Files**
- `app/src/views/UserAdminView.vue` (new) — two-section page per spec §9.5.
- `app/src/router/index.ts` — register route with `meta: { requiresRole: 'admin' }`.
- `app/src/App.vue:25-47` — add nav entry.

**Steps**
1. Existing-users list with debounced search, cursor pagination, role filter chips, inline role dropdown, revoke/restore actions, audit drawer.
2. Add-user panel with provider-directory search, already-added badge, role picker defaulting to `modifier`.
3. Disable own row + configured-admin rows with visible explanation (not hidden).

**Exit**: end-to-end: admin searches GitHub, adds user as modifier, changes role to admin, revokes, restores, opens audit log. Configured admin row cannot be modified; admin's own row cannot be modified.

## Phase 9 — Rollout & docs

1. Update `docs/INTEGRATIONS.md` with `ADMIN_USERS` env var and per-provider directory-search behavior.
2. Update `docs/DECISIONS.md` with a new decision record pointing to `docs/ROLE_BASED_AUTH.md`.
3. One-time banner component in the app explaining the new model — remove after first release.
4. Deployment runbook: set `ADMIN_USERS` → apply migrations → deploy.

**Exit**: staged deploy succeeds; all existing users retain access as `modifier`; configured admins can reach `/admin/users` and grant/revoke other users.

## Test matrix (for phases 3–8)

| Scenario | Expected |
|---|---|
| User not in DB, not in ADMIN_USERS, logs in | Denied with `ACCESS_DENIED` |
| User in `ADMIN_USERS` on first login | Logged in as `admin`; DB stub enriched with profile fields |
| Viewer hits a write route | 403 `FORBIDDEN` |
| Modifier hits `/api/admin/users` | 403 `FORBIDDEN` |
| Admin PATCHes own role | 409 `CANNOT_MODIFY_SELF` |
| Admin revokes configured admin | 409 `CONFIGURED_ADMIN_IMMUTABLE` |
| Admin changes live user from modifier→viewer | Next write by that user → 403 + frontend re-fetches `/api/me` |
| Admin revokes live user | Next request → 401 `ACCESS_REVOKED` |
| Boot with empty/mismatched `ADMIN_USERS` | Server fails to start |

## Not in this plan

- Per-resource ACLs.
- Invite emails / SMTP.
- Provider group/team sync.
- Audit-log UI beyond per-user drawer.
