---
name: provider-adapter
description: Rules for working with moou's provider adapter system — adding new integrations, modifying existing adapters (ValueEdge, GitHub), or touching auth/refresh/backend routes. Use when tasks involve adapter.ts, valueedge-adapter.ts, github-adapter.ts, refresh.ts, backend.ts, or provider auth.
---

# Provider Adapter Skill

moou integrates with external issue trackers (ValueEdge, GitHub, Jira, Linear, …) through a swappable adapter pattern. Only one provider is active at a time, set via `EXTERNAL_PROVIDER` env var.

## ⚠️ Core invariant: the app is provider-agnostic

All shared application code — routes, middleware, refresh jobs, SSE, frontend — must remain completely unaware of which provider is active. This is not just a style preference; it is what allows providers to be swapped without touching core code.

**Rules:**

- Routes call `getAdapter()` and use the `ProviderAdapter` interface. They never `import` from a specific adapter file.
- Shared code (`refresh.ts`, `backend.ts`, `outcomes.ts`, `App.vue`, `useApi.ts`) references only types and classes from `adapter.ts` — never from `valueedge-adapter.ts`, `github-adapter.ts`, or any future adapter.
- Provider-specific subclasses (e.g. `VEAuthError`) are **private to their adapter file** and never exported.
- If you find yourself writing `if (provider === 'valueedge')` in a route or shared module, stop — that logic belongs in the adapter.

```
✅ routes/backend.ts  →  getAdapter().searchItems(...)   (correct)
❌ routes/backend.ts  →  import { VEAdapter } from '../providers/valueedge-adapter.js'  (wrong)
❌ routes/backend.ts  →  if (process.env.EXTERNAL_PROVIDER === 'valueedge') { ... }  (wrong)
```

## Key files

| File | Purpose |
|---|---|
| `api/src/providers/adapter.ts` | Generic `ProviderAdapter` interface + shared types + `ProviderAuthError` base class |
| `api/src/providers/valueedge-adapter.ts` | ValueEdge implementation |
| `api/src/providers/github-adapter.ts` | GitHub implementation |
| `api/src/providers/refresh.ts` | Background job that re-fetches `cached_details` every 15 min using ETags |
| `api/src/routes/backend.ts` | Express routes: search, connect, publish, refresh — all call `getAdapter()` |
| `api/src/routes/outcomes.ts` | CRUD for outcomes + external-link insert/refresh |

## Auth error propagation — CRITICAL

This is the most important design invariant. Expired or invalid tokens **must** reach the user. Silent swallowing causes confusing empty results and missing data.

### Pattern

**1. Define a private subclass in your adapter** (never export it — shared code must stay provider-agnostic):

```typescript
import { ProviderAuthError } from './adapter.js';

// private — not exported
class MyProviderAuthError extends ProviderAuthError {}

// throw it on 401 or 403
if (res.status === 401 || res.status === 403) {
  throw new MyProviderAuthError();
}
```

**2. Re-throw in `refresh.ts`** — `refreshLink()` re-throws `ProviderAuthError`; callers decide what to do:

```typescript
} catch (err) {
  if (err instanceof ProviderAuthError) throw err;
  console.error(`Failed to refresh link ${linkId}:`, err);
  return false;
}
```

**3. Routes return 401** for synchronous calls:

```typescript
} catch (err) {
  if (err instanceof ProviderAuthError) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: err.message } });
    return;
  }
  // ... handle other errors
}
```

**4. Fire-and-forget paths broadcast an SSE event** (they can't return HTTP 401):

```typescript
refreshLink(link.id, req.accessToken).catch((err) => {
  if (err instanceof ProviderAuthError) broadcast({ type: 'session_expired' });
});
```

**5. Frontend handles both paths:**
- `app/src/composables/useApi.ts` — redirects to `/login` on any 401 from the API
- `app/src/App.vue` — listens for `session_expired` SSE → toast → redirect to `/login`

### Rules

- **Never catch `ProviderAuthError` and return `[]` or `null`.** That looks like "no results" and confuses users.
- **`searchItems` is not exempt.** A 401 during search must throw, not silently return empty.
- **Distinguish auth errors from others.** 404 (deleted), 429 (rate limit), 5xx (backend down) are different — don't throw `ProviderAuthError` for those.
- **Don't export your provider subclass.** Only `ProviderAuthError` from `adapter.ts` is shared.

## `searchItems` contract

Return up to ~20 items. Throw `ProviderAuthError` on 401/403. For all other errors: `console.error` and return `[]`.

## `getItemDetails` contract

- On 304: return the literal string `'not-modified'` (used by refresh job for ETag-conditional requests).
- On 401/403: throw `ProviderAuthError`.
- On 404: throw a plain `Error` (item was deleted; caller handles gracefully).
- Return `{ item: BackendItem, etag?: string }` on success.

## `createItem` / `updateItem` contracts

- Throw `ProviderAuthError` on 401/403.
- Throw a descriptive `Error` for unsupported entity types or backend failures.
- Route layer catches and returns `502 BACKEND_ERROR` with the message.

## Refresh strategy

`refresh.ts` polls links whose `fetchedAt` is older than 15 min. It sends saved ETags as `If-None-Match`. If the adapter returns `'not-modified'`, the DB row is not touched. This keeps the refresh job rate-limit-friendly on backends like GitHub.

## Adding a new adapter

1. Create `api/src/providers/<name>-adapter.ts` implementing `ProviderAdapter`.
2. Register it in `api/src/providers/adapter.ts` in the `adapters` map.
3. Add auth module at `api/src/auth/<name>.ts` if OAuth is needed; update `api/src/middleware/auth.ts` to populate `req.accessToken`.
4. Add env vars to `.env.example`.
5. No frontend changes needed — UI talks to `/api/backend/*` only.

See `docs/INTEGRATIONS.md` for the full walkthrough with a worked Linear example.
