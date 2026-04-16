---
title: "Required Fields Config, Workspace Access Guard, and Primary Item Sync"
type: feat
status: draft
date: 2026-04-16
---

# Required Fields Config, Workspace Access Guard, and Primary Item Sync

## Overview

Three related improvements to the backend integration layer and outcome model:

1. **Required fields configuration** — per-entity-type field requirements stored in the database, replacing reliance on ValueEdge's server-side scripting which cannot be replicated via the metadata API.
2. **Workspace access guard on login** — after a successful ValueEdge token exchange, verify the user can actually reach the configured workspace before completing login; destroy the token and surface an error if not.
3. **Primary item concept for outcomes** — each outcome can designate one linked external item as its "primary item". The user can pull the primary item's name or description into moou (overwriting the outcome field), or push the outcome's name or description back to the primary item. All other bidirectional name/description sync functionality is removed.

---

## Phase 1 — Required Fields Configuration

### Problem

ValueEdge uses server-side UDF/business rules to decide which fields are required for a given entity type. The metadata API returns a static `required` flag that reflects only schema-level constraints, not workspace policy. As a result `getCreateOptions` may mark fields as optional that the workspace actually requires, causing create requests to fail with opaque 400/422 errors.

Since this scripting cannot be replicated client-side, the solution is to store field requirements in configuration that an administrator can maintain.

### Schema

Add a new table to `api/src/db/schema.ts`:

```sql
CREATE TABLE backend_field_config (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    TEXT NOT NULL,           -- 'valueedge', 'github', etc.
  entity_type TEXT NOT NULL,           -- 'story', 'feature', 'epic', etc.
  field_name  TEXT NOT NULL,           -- matches CreateField.name
  required    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, entity_type, field_name)
);
```

### API changes

- `GET /api/backend/field-config?provider=X&entityType=Y` — returns all config rows for the given provider + entity type. Admin-only (role check).
- `PUT /api/backend/field-config` — upsert a config row (body: `{ provider, entityType, fieldName, required }`). Admin-only.
- `DELETE /api/backend/field-config/:id` — remove a config row. Admin-only.

### Adapter changes (`adapter.ts` / `valueedge-adapter.ts`)

- In `getCreateOptions`, after building the `fields` array from metadata, load the matching `backend_field_config` rows for this provider + entityType.
- For each returned field, override `required` if a config row exists for that `fieldName`.
- If a config row references a field not present in the metadata response (e.g. a field not in `SURFACE_FIELDS`), add it to the output so the form renders it.

### UI changes

- Add an admin panel section (or a settings route) **Field Requirements** that lists entity types and their configured required fields, and allows toggling `required` and reordering.
- The existing `VEPublishDialog.vue` field form requires no changes — it already respects `CreateField.required`.

### Migration

New Drizzle migration file. No destructive changes.

---

## Phase 2 — Workspace Access Guard on Login

### Problem

ValueEdge's Interactive Token Sharing flow can succeed (the user authenticates against the shared space) even if the user does not have a role in the specific workspace moou is configured to use. In that case all subsequent API calls fail. The user sees a confusing authenticated-but-broken state.

### Changes to `api/src/auth/valueedge.ts`

After the access token is obtained and before the session is saved, perform a lightweight workspace probe:

```
GET ${BASE_URL}/api/shared_spaces/${SHARED_SPACE}/workspaces/${WORKSPACE}?fields=id,name
```

Headers: same `LWSSO_COOKIE_KEY` cookie + `HPECLIENTTYPE`.

**Decision table:**

| Response | Action |
|---|---|
| 200 | Continue — user has workspace access |
| 401 / 403 | Abort: return `403 WORKSPACE_ACCESS_DENIED` |
| 404 | Abort: return `400 WORKSPACE_NOT_FOUND` (misconfiguration) |
| Other non-2xx | Abort: return `502 BACKEND_ERROR` with status code in message |
| Network error | Abort: return `502 BACKEND_ERROR` |

On abort the `LWSSO_COOKIE_KEY` token must **not** be stored in the session. The session cookie must not be set. The user is returned to the login screen with an appropriate error message.

### Frontend changes (`LoginView.vue`)

The existing polling loop already handles error responses. Add handling for the new `WORKSPACE_ACCESS_DENIED` and `WORKSPACE_NOT_FOUND` codes so they surface a human-readable message rather than a generic "Backend error".

---

## Phase 3 — Primary Item for Outcomes

### Overview

Currently an outcome can have many external links (connected or published items). No link is distinguished from another. Name and description sync between moou and any linked item does not exist. This phase introduces:

- A **primary link** designation on each outcome (one-of-many, nullable).
- **Pull buttons** beside the outcome's name and description fields — clicking overwrites the moou field with the primary item's cached value.
- **Push buttons** beside the same fields — clicking writes the moou field back to the primary item via the provider API.
- Removal of any other bidirectional name/description sync features.

### Phase 3a — Schema and Migration

Add `primary_link_id` to the `outcomes` table:

```sql
ALTER TABLE outcomes
  ADD COLUMN primary_link_id UUID REFERENCES external_links(id) ON DELETE SET NULL;
```

- Nullable. No default.
- `ON DELETE SET NULL` ensures removing a link automatically clears the primary designation.

New Drizzle migration file.

Update `shared/src/types.ts` `Outcome` interface to include `primaryLinkId: string | null`.

### Phase 3b — Provider Adapter: `updateItem`

Add a new optional method to the `ProviderAdapter` interface in `adapter.ts`:

```typescript
/**
 * Write name and/or description back to a backend item.
 * Only fields present in `changes` are written (partial update).
 */
updateItem?(
  token: string,
  entityType: string,
  entityId: string,
  changes: { name?: string; description?: string },
): Promise<void>;
```

**`ValueEdgeAdapter` implementation:**

```
PUT ${apiBase()}/${path}/${entityId}
Body: { data: [{ name?, description? }] }   (only fields provided)
```

Map moou's `title` → VE's `name`. On non-2xx, throw with descriptive message.

**`GitHubAdapter` implementation:**

```
PATCH /repos/{owner}/{repo}/issues/{issue_number}
Body: { title?, body? }
```

Map moou's `title` → `title`, `description` → `body`.

### Phase 3c — API Routes

**Set / clear primary link:**

```
PATCH /api/outcomes/:id/primary-link
Body: { linkId: string | null }
```

- Validates that `linkId` belongs to the given outcome (if non-null).
- Updates `outcomes.primary_link_id`.
- Records history (`updated`, `primaryLinkId`).
- Broadcasts `outcome_updated` SSE event.
- Returns the updated outcome.

**Pull from primary item (name or description):**

```
POST /api/outcomes/:id/pull-primary
Body: { field: 'title' | 'description' }
```

- Requires the outcome to have a `primary_link_id`.
- Reads `cachedDetails.title` / `cachedDetails.description` from the primary link row.
  - If cached details are stale or absent, triggers a refresh first (re-uses `refreshLink`).
- Overwrites the outcome's `title` or `description` with the fetched value.
- Records history.
- Broadcasts `outcome_updated`.
- Returns `{ outcome, pulledValue: string }`.

**Push to primary item (name or description):**

```
POST /api/outcomes/:id/push-primary
Body: { field: 'title' | 'description' }
```

- Requires the outcome to have a `primary_link_id` and a configured adapter with `updateItem`.
- Reads the current outcome `title` / `description`.
- Calls `adapter.updateItem(token, entityType, entityId, { name? | description? })`.
- On success, triggers a refresh of the primary link's cached details to keep the cache consistent.
- Returns `{ ok: true }`.
- On adapter error, returns `502 BACKEND_ERROR`.

**Return `primaryLinkId` in all outcome responses:**

Ensure `GET /outcomes`, `GET /outcomes/:id`, and `PATCH /outcomes/:id` all include `primaryLinkId` in the serialised output (already works via `select().returning()` once the column exists).

### Phase 3d — Sync removal

Remove or disable:

- Any existing route or adapter method that automatically mirrors outcome title/description to a linked item on outcome save.
- Any frontend code that triggers a name/description sync on link connect or publish (search for "sync" in VEPublishDialog, ConnectDialog, and OutcomeForm — remove if found).

The per-link **Refresh** button in `ExternalLinkCard.vue` (which refreshes execution metadata: state, labels, assignee, progress) is **not** removed — it updates only the cached display data, not the outcome fields.

### Phase 3e — UI Changes

**`ExternalLinkCard.vue`**

- Accept a new prop `isPrimary: boolean`.
- When `isPrimary` is true, render a "Primary" badge (e.g. a star or pill).
- Add a "Set as primary" button (or "Remove primary" if already primary).
- Emit a `setPrimary` / `clearPrimary` event; `OutcomeDetail` handles the API call.

**`OutcomeDetail.vue` / `OutcomeForm.vue`**

Beside the **title** field:
- "↓ Pull title" button — visible when `outcome.primaryLinkId` is set and `cachedDetails.title` is available.
- "↑ Push title" button — visible when `outcome.primaryLinkId` is set and the adapter supports `updateItem`.

Beside the **description** field:
- "↓ Pull description" / "↑ Push description" — same conditions.

Button states:
- Disabled while the operation is in flight.
- Show a transient success/error toast on completion.

**Primary item summary panel (optional, deferred to Phase 3f)**

A collapsible section in `OutcomeDetail` that shows the primary item's title, state, and a link to the backend item, distinct from the full link list.

### Phase 3f — "Change Primary Item" UI

A small inline picker (reuse the existing backend search bar) allowing the user to:

1. Search for and select any item.
2. If the item is already a connected/published link, set it as primary.
3. If the item is not yet linked, offer to add it as a connected link and set it as primary in one step.
4. Clear the primary designation.

This picker should also be accessible from the Primary item summary panel (Phase 3e).

---

## Implementation Order

| # | Phase | Effort | Risk |
|---|---|---|---|
| 1 | Required fields config — DB + API | S | Low |
| 2 | Required fields config — adapter merge + admin UI | M | Low |
| 3 | Workspace access guard on login | S | Low |
| 4 | Primary item — schema + migration | XS | Low |
| 5 | `updateItem` adapter method (VE + GitHub) | S | Medium |
| 6 | Pull/push API routes | S | Low |
| 7 | `ExternalLinkCard` primary badge + set/clear | S | Low |
| 8 | Pull/push buttons in OutcomeDetail + OutcomeForm | S | Low |
| 9 | Remove other name/description sync | XS | Low |
| 10 | Change-primary-item picker (Phase 3f) | M | Low |

Phases 3–9 can proceed independently of 1–2. The workspace guard (step 3) should be delivered early as it directly blocks users from being silently broken post-login.
