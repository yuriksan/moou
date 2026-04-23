# Role-Based Authentication

## 1. Goals & non-goals

**Goals**
- Gate login on the server: a user with no assigned role cannot sign in, regardless of provider success.
- Bootstrap one or more initial admins from provider configuration (env vars) so the system isn't bricked on first deploy.
- Admins can grant, change, and revoke access for other users via the UI.
- Adding a new user requires searching the active provider's user directory (GitHub or ValueEdge) — we don't invent identities locally.
- The existing-user list remains usable when it grows into the hundreds.

**Non-goals (this iteration)**
- Per-resource ACLs (milestone-level sharing, team scopes, etc.).
- SSO group/team sync — roles are managed in moou, not inherited from the provider.
- Self-service access requests; access is always admin-granted.
- Invite emails / SMTP dependency.

## 2. Role model

Three roles, stored as a non-null enum in `users.role`:

| Role       | Permissions                                                                 |
|------------|-----------------------------------------------------------------------------|
| `admin`    | Everything `modifier` does + user management (grant/change/revoke roles).   |
| `modifier` | Read + create/update/delete all application data (milestones, outcomes, tags, comments…). |
| `viewer`   | Read-only across the app. Cannot mutate anything.                           |

A user not present in `users`, or whose row has `status='revoked'`, cannot log in — the server denies the session before redirecting out of the auth flow.

Today `role` is nullable free-text used as a job title (seeded "Director of Engineering", etc. — `api/src/db/seed.ts:6-11`). That field is renamed to `jobTitle` to avoid a semantics collision.

## 3. Schema changes

`api/src/db/schema.ts:13-21` — `users` table.

```diff
 export const users = pgTable('users', {
   id: text('id').primaryKey(),
   provider: text('provider').notNull().default('mock'),
   providerId: text('provider_id').notNull().default(''),
   name: text('name').notNull(),
-  role: text('role'),
+  jobTitle: text('job_title'),                                         // renamed from role
+  role: text('role').notNull(),                                         // new meaning
+  status: text('status').notNull().default('active'),
+  email: text('email'),                                                // for search/display
+  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
+  createdBy: text('created_by').references(() => users.id),            // admin who granted
+  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
   initials: text('initials').notNull(),
   avatarUrl: text('avatar_url'),
+}, (table) => [
+  check('users_role_check', sql`${table.role} IN ('admin', 'modifier', 'viewer')`),
+  check('users_status_check', sql`${table.status} IN ('active', 'revoked')`),
+]);
+
+export const userAuditLog = pgTable('user_audit_log', {
+  id: uuid('id').primaryKey().defaultRandom(),
+  targetUserId: text('target_user_id').notNull().references(() => users.id),
+  actorUserId: text('actor_user_id').notNull().references(() => users.id),
+  action: text('action').notNull(),  // CHECK: 'granted','role_changed','revoked','restored'
+  fromRole: text('from_role'),
+  toRole: text('to_role'),
+  at: timestamp('at').notNull().defaultNow(),
+});
```

**Migration strategy** (drizzle-kit, three migrations — nullable → backfill → enforce):
1. Add the new columns as nullable.
2. Copy existing `role` into `jobTitle`.
3. Set `role = 'admin'` for any user ID listed in `ADMIN_USERS`; set `role = 'modifier'` for everyone else (chosen default — §11).
4. Apply NOT NULL + CHECK constraints.
5. Update seed data (`api/src/db/seed.ts`) to populate both columns.

`status='revoked'` is preferred over row deletion because `milestones.createdBy`, `outcomes.createdBy`, `comments.createdBy`, and `history.changedBy` all FK to `users.id` — deleting users breaks history.

## 4. Admin bootstrap via provider configuration

New env var consumed at server startup:

```
ADMIN_USERS=github:12345,github:67890              # GitHub numeric IDs
ADMIN_USERS=valueedge:alice@example.com             # ValueEdge login names
```

Format: comma-separated `<provider>:<providerId>` tokens. Provider prefix must match the active `EXTERNAL_PROVIDER` — mismatched entries are logged and ignored.

**Reconciliation on boot** (`api/src/app.ts` before `app.listen`):
- For each valid token, upsert a `users` row with `role='admin'`, `status='active'`.
- If the row doesn't exist, insert a stub (`name = providerId`, `initials = '??'`). Real profile fields fill in on first login.
- The set of configured IDs is kept in memory as `configuredAdminIds: Set<string>` for runtime immutability checks (§7).
- **Boot-time assertion**: if `ADMIN_USERS` contains no valid entry for the active provider, the server refuses to start. Prevents accidentally deploying a system with no admin. **Exemption**: when `EXTERNAL_PROVIDER` is `mock` (local dev / tests), the assertion is skipped — mock mode seeds its own users and doesn't need `ADMIN_USERS`.

## 5. Login gate

Touch points: `api/src/auth/github.ts:127-148`, `api/src/auth/valueedge.ts:119-173`, `api/src/middleware/auth.ts:34-93`.

**New check, applied inside both OAuth/handshake callbacks after we know `provider:providerId`:**

```
const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
if (!user || user.status === 'revoked') {
  clearSession();
  redirect(`/login?error=ACCESS_DENIED`);
  return;
}
// update lastLoginAt, refresh name/avatar/email from provider profile
```

**Remove auto-creation of users on first login** in three places:
- OAuth callbacks (`github.ts:127`, `valueedge.ts:167`) — currently upsert a new user row on first successful login.
- Auth middleware (`api/src/middleware/auth.ts`) — currently auto-inserts a user from session data if the DB row is missing (handles DB-wipe-while-cookie-survives scenario). This bypass must also be removed so that a missing row = denied, not silently re-created.

A row must already exist — either bootstrapped from `ADMIN_USERS` or granted by an admin via the UI. This is the enforcement point the spec hinges on.

**Middleware** (`api/src/middleware/auth.ts`): on every request, re-check `status !== 'revoked'` so revocation takes effect within one request cycle rather than only at next login.

**Frontend** (`app/src/views/LoginView.vue`): surface `ACCESS_DENIED` with a clear message ("Your account isn't authorized. Ask an admin to grant you access.") alongside the existing `WORKSPACE_ACCESS_DENIED` handling (lines 100-103).

## 6. Authorization middleware

Replace the ad-hoc `req.user?.role === 'admin'` checks (`api/src/routes/backend.ts:275-320`) with reusable guards in `api/src/middleware/authorize.ts`:

```ts
export const requireRole = (...allowed: Role[]) => (req, res, next) => {
  if (!req.user?.role) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
  next();
};
export const requireWrite = requireRole('admin', 'modifier');
export const requireAdmin = requireRole('admin');
```

**Route audit required.** Every route that mutates data (tag CRUD, milestone CRUD, outcome CRUD, comments, field config…) gets `requireWrite`. Read routes remain open to all three roles (already behind global `authMiddleware` at `api/src/app.ts:156`). User-management routes get `requireAdmin`.

## 7. User-management API

All under `/api/admin/users`, all gated by `requireAdmin`.

| Method | Path                                             | Purpose                                                                 |
|--------|--------------------------------------------------|-------------------------------------------------------------------------|
| GET    | `/api/admin/users?q=&role=&status=&cursor=&limit=50` | Paginated list of existing moou users. Cursor-based; `q` matches name/email/providerId case-insensitively. |
| POST   | `/api/admin/users`                               | Create user from provider search result. Body: `{ providerId, name, email?, avatarUrl?, role }`. Default role preselected by UI: `modifier`. |
| PATCH  | `/api/admin/users/:id`                           | Change role. Body: `{ role }`.                                          |
| POST   | `/api/admin/users/:id/revoke`                    | Set `status='revoked'`; does not delete row.                            |
| POST   | `/api/admin/users/:id/restore`                   | Set `status='active'`.                                                  |
| GET    | `/api/admin/users/:id/audit`                     | Role-change history for one user (from `user_audit_log`).               |
| GET    | `/api/admin/directory?q=&cursor=`                | Search the active provider's user directory. Proxies to the adapter.    |

**Guard rails (server-enforced):**

- **`CANNOT_MODIFY_SELF`** — admins cannot change their own role or revoke themselves. Applies on PATCH and revoke regardless of whether other admins exist.
  ```ts
  if (targetId === req.user.id) {
    return res.status(409).json({ error: 'CANNOT_MODIFY_SELF',
      message: 'Admins cannot change or revoke their own role.' });
  }
  ```
- **`CONFIGURED_ADMIN_IMMUTABLE`** — users listed in `ADMIN_USERS` cannot be modified through the UI at all. Role dropdown, revoke, and restore all refuse.
  ```ts
  if (configuredAdminIds.has(targetId)) {
    return res.status(409).json({ error: 'CONFIGURED_ADMIN_IMMUTABLE',
      message: 'This user is configured via ADMIN_USERS and cannot be changed from the UI.' });
  }
  ```
  To change a configured admin, an operator edits `ADMIN_USERS` and restarts the server — same path as bootstrap, keeping the source of truth consistent.

**Audit log**: every POST/PATCH/revoke/restore writes a `user_audit_log` row with `actorUserId = req.user.id`. No UPDATE or DELETE endpoints for the audit log — append-only.

**Rate limiting**: `/api/admin/directory` hits external APIs — add `express-rate-limit` scoped per-admin (the lib is already a dependency).

## 8. Provider adapter: user directory search

This is the one new capability the adapter pattern needs (`.copilot/skills/provider-adapter/SKILL.md`, `api/src/providers/adapter.ts:44-80`). Follow the existing pattern: define it in the interface, implement per provider, route through `getAdapter()`.

```ts
export interface ProviderUser {
  providerId: string;      // stable ID within the provider
  name: string;
  email?: string;
  avatarUrl?: string;
  handle?: string;         // e.g. GitHub login
}

export interface ProviderAdapter {
  // …existing members…
  searchDirectory(
    token: string,
    query: string,
    opts?: { cursor?: string; limit?: number }
  ): Promise<{ results: ProviderUser[]; nextCursor?: string }>;
}
```

**GitHub implementation**: GitHub Search API `/search/users?q=<query>`. Rate limit is 30 req/min authenticated — cache per-query for 60s in-process.

**ValueEdge implementation**: workspace users endpoint (`/api/shared_spaces/{ss}/workspaces/{ws}/workspace_users`) with `query` filter. **Scoped to the configured workspace only** — results never cross workspace boundaries.

**Auth error contract**: `searchDirectory` throws `ProviderAuthError` on 401/403, same as every other adapter method. The `/api/admin/directory` route catches it and returns 401 so the frontend session-expiry flow triggers (`app/src/composables/useApi.ts:64-67`).

## 9. Frontend

Vue 3, Vue Router 4, **no Pinia** — state via refs/composables (`app/src/composables/useApi.ts`, `app/src/App.vue:77-91`).

### 9.1 Current-user state

Extend `authenticatedUser` in `App.vue` to carry `role` and `status`. New `useAuth()` composable:

```ts
// app/src/composables/useAuth.ts
export const currentUser = ref<User | null>(null);
export const isAdmin  = computed(() => currentUser.value?.role === 'admin');
export const canWrite = computed(() => ['admin','modifier'].includes(currentUser.value?.role ?? ''));
```

### 9.2 Route guards

Vue Router `beforeEach` guard reads route `meta`:

```ts
{ path: '/admin/users', component: UserAdminView, meta: { requiresRole: 'admin' } }
```

Guard redirects to `/` with a toast if the role check fails. Not a security boundary (server is) — prevents showing pages that will 403.

### 9.3 UI treatment rule of thumb

**Hide** features a user has no business knowing exist. **Disable with explanation** features they can see but can't act on.

Hiding alone confuses viewers looking at the same screen as a teammate with edit buttons. Disabling with a tooltip turns a silent denial into a learnable rule.

### 9.4 Treatment per surface

| Surface | Viewer | Modifier | Rationale |
|---|---|---|---|
| Admin nav dropdown (Users, Field Config, Tags) | **Hide** | **Hide** | No reason to advertise admin tools. `v-if="isAdmin"` on `App.vue:25-47`. |
| `/admin/*` routes | Guard → redirect to `/` with toast | Guard → redirect | Defense in depth; server enforces. |
| Primary "New Milestone" / "New Outcome" buttons | **Disabled** with tooltip: *"Read-only access. Ask an admin to grant modifier access."* | Enabled | Stable layout; educates the user. |
| Inline row actions (edit pencil, delete ×, drag-handle reorder) | **Hide** | Show | Contextual clutter; hiding is cleaner than ghosted icons. |
| Edit forms reached via deep link | Fields read-only; save button **hidden** | Editable | Viewer can still open a milestone detail and read every field. |
| Comment composer | Composer replaced with muted note: *"Read-only access — you can't post comments."* Existing comments remain visible. | Visible and enabled | Comment history is part of the read surface. |
| Tag chips, status pickers, assignee pickers (inline edits) | Static badges, not clickable | Clickable | Same reasoning as inline actions. |
| Bulk-select checkboxes | **Hide** | Show | Without bulk actions available, checkboxes are dead weight. |
| Keyboard shortcuts that mutate | No-op + brief toast *"Read-only access"* | Active | Prevents silent failure on muscle memory. |

### 9.5 Admin page rules (`UserAdminView.vue`)

Two sections:

**(A) Existing users** — primary view
- Server-side searchable, paginated list. Debounced 250ms query hits `GET /api/admin/users?q=…&cursor=…`.
- Columns: avatar + name, email/handle, role (inline dropdown to change), status, last login, actions (revoke/restore, view audit).
- Cursor-based "load more" for hundreds of rows without client-side filtering.
- Filter chips: role (`admin`/`modifier`/`viewer`), status (`active`/`revoked`).

**(B) Add user** — modal/side panel
- Search input hits `GET /api/admin/directory?q=…`. Shows provider avatars + name + handle.
- Users already in moou show a badge ("Already added — modifier") and clicking jumps to their row in (A) instead of re-adding.
- Picking a new result opens a role picker (`modifier` preselected) then POSTs to `/api/admin/users`.
- Directory results are ephemeral — in-memory for the session only.

**Admin self-restrictions (visible, not hidden):**
- **Own row**: role dropdown and revoke button **disabled** with inline text *"You can't change your own role."*
- **Configured admin rows** (in `ADMIN_USERS`): role dropdown and revoke button **disabled**, lock icon + tooltip *"Configured via ADMIN_USERS. Edit the environment variable and restart to change."* Row also carries a `Configured` badge next to the name.

### 9.6 Role visibility to the user themselves

Role badge in the user menu (existing avatar dropdown in `App.vue`).
- Viewer: persistent header chip *"Read-only"*.
- Admin: chip *"Admin"* for symmetry and reminder of elevated rights.
- Modifier: no chip (default experience).

### 9.7 Mid-session role changes

Admin demotes someone while they're using the app. Next API call returns 403 (write) or the middleware status recheck (§5) returns 401 (revoke). Add a global interceptor in `useApi.ts` next to the existing 401 handler (lines 64-67):

- On 403 with `error: 'ROLE_CHANGED'` (or any unexpected 403 on a route that previously worked): refetch `/api/me`, update `currentUser`, show toast *"Your access level has changed."* — no forced logout, UI refreshes so affordances match reality.
- On 401 with `error: 'ACCESS_REVOKED'`: existing session-expiry flow takes over, user lands on login with the access-denied message.

### 9.8 Accessibility

- Disabled controls include `aria-disabled="true"`; tooltip is keyboard-focusable, not hover-only.
- Tooltip content rendered in an `aria-describedby` span so screen readers announce the reason, not just "button, disabled."
- Toasts use `role="status"` (for info) or `role="alert"` (for role-change events) so assistive tech picks them up.

## 10. Security considerations

- **Self-lockout**: enforced server-side (§7 guard rails), not just hidden in UI.
- **Session revocation latency**: middleware re-check on every request (§5) makes revoke effective within one request, not one login cycle. Cookie lifetime unchanged at 14 days.
- **Audit log immutability**: no UPDATE or DELETE endpoints for `user_audit_log`. Written by routes, read-only elsewhere.
- **Rate limiting**: `/api/admin/directory` uses `express-rate-limit` scoped per-admin.
- **Provider identity collisions**: `users.id` is `<provider>:<providerId>`. Switching `EXTERNAL_PROVIDER` on a live deployment means nobody matches — admins from the old provider still exist in the DB but no one can log in. Operator responsibility; not automated.
- **CSRF**: all mutations are same-origin fetch with the session cookie. No change from today.
- **ADMIN_USERS as ground truth**: UI-immutability means an operator who loses their env-var config cannot "recover" by promoting themselves — they must restore the env var. This is a deliberate tradeoff for stronger bootstrapping guarantees.

## 11. Rollout plan

1. **Schema migration** with two-phase fill (add columns nullable → backfill → enforce constraints). `drizzle-kit generate` + `migrate` on deploy.
2. Set `ADMIN_USERS` in the deployment environment **before** rolling forward. Boot-time assertion (§4) fails the deploy if this is missing.
3. Deploy the new login gate + middleware. Existing users are backfilled with `role='modifier'`, so they remain logged-in-capable. Anyone not in the users table is locked out.
4. Deploy the admin UI. Admins immediately add missing users with appropriate roles.
5. Remove legacy free-text `role` usage in seed data / demo content; confirm `jobTitle` is what's displayed in user chips throughout the app.
6. One-time in-app banner explaining the new model for the first release.

## 12. Decisions resolved

- **Default role during migration**: `modifier` (keeps existing users functional; conservative but not destructive).
- **Role model**: `admin`, `modifier`, `viewer` — three roles.
- **ValueEdge directory scope**: workspace users only.
- **Configured-admin behavior**: UI-immutable; changes require editing `ADMIN_USERS` and restarting.
- **Self-modification**: admins cannot change their own role or revoke themselves, even when other admins exist.
- **Only admins** can add, remove, or change roles for users — enforced by `requireAdmin` on all `/api/admin/users*` endpoints.
