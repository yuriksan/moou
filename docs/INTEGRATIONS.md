# Backend Integrations — Developer Guide

This document is for developers adding a new backend (issue tracker / work management system) to moou. If you're a user setting up GitHub access, see [GITHUB-SETUP.md](GITHUB-SETUP.md) instead.

## Overview

moou sits upstream of issue trackers. It owns "what" and "why" — outcomes, motivations, scoring, scheduling — and links those to "who" and "how" in your tracker (GitHub, ValueEdge, Jira, Linear, etc.). Each deployment is configured for a single backend at a time, set via `EXTERNAL_PROVIDER`.

A backend integration consists of two pieces:

1. **Auth module** — handles user sign-in and supplies the access token used for backend API calls. Optional if your backend uses something other than OAuth (e.g. an admin API key).
2. **Provider adapter** — implements the `ProviderAdapter` interface so the rest of the codebase can search, fetch, refresh, and create items without knowing or caring which backend is configured.

The contract is intentionally narrow: routes call the adapter through `getAdapter()` and never touch provider-specific code.

## The provider adapter interface

Defined in `api/src/providers/adapter.ts`. Every adapter must implement four methods plus a small amount of metadata.

```typescript
interface ProviderAdapter {
  // Identity
  name: string;                    // 'github', 'valueedge', 'jira', 'linear'
  label: string;                   // human-readable: 'GitHub', 'OpenText ValueEdge'
  entityTypes: ProviderEntityType[];

  // Search backend items by free-text query
  searchItems(token: string, query: string, entityType?: string): Promise<BackendItem[]>;

  // Fetch a single item, with ETag conditional support
  getItemDetails(
    token: string,
    entityType: string,
    entityId: string,
    etag?: string,
  ): Promise<{ item: BackendItem; etag?: string } | 'not-modified'>;

  // Fetch child progress (e.g. stories under a feature). Return null if not applicable.
  getChildProgress(
    token: string,
    entityType: string,
    entityId: string,
  ): Promise<ChildProgress | null>;

  // Create a new item from an outcome
  createItem(
    token: string,
    entityType: string,
    title: string,
    description?: string,
  ): Promise<{ entityId: string; url: string }>;
}
```

The shared types — `BackendItem`, `ChildProgress`, `ProviderEntityType` — are also defined in `adapter.ts`. Your adapter is responsible for mapping the backend's native objects into these shapes.

### Field-by-field guide

**`name`** — short snake-case slug. Used as the value of `EXTERNAL_PROVIDER` and stored on every `external_links.provider` row in the database. Keep it stable forever; renaming would orphan existing links.

**`label`** — display string the UI shows in dialog titles and toast messages ("Connect to GitHub", "Search ValueEdge items…").

**`entityTypes`** — what kinds of items the provider exposes. GitHub returns `[issue, pr]`. ValueEdge returns `[epic, feature, story]`. Mark exactly one with `default: true` so the publish flow knows which to default the picker to. Types that can't be created from a title + description alone (GitHub PRs need head/base branches; ValueEdge sometimes restricts story creation by workspace) should still appear in `entityTypes` so they show up in connect search results, but they should throw from `createItem` so the publish route surfaces a `502 BACKEND_ERROR`.

**`searchItems(token, query, entityType?)`** — return up to ~20 items matching the user's query. The frontend already debounces input. Filter by `entityType` when provided. Quietly return `[]` on a backend error rather than throwing — search failures shouldn't cascade into a broken UI. Use `console.error` for diagnostics.

**`getItemDetails(token, type, id, etag?)`** — fetch one item. If `etag` is provided, send it as `If-None-Match`. Return the literal string `'not-modified'` for a 304 response. Otherwise return `{ item, etag }` where `etag` is whatever the backend returned in the `ETag` header (or `undefined` if it didn't). The refresh job depends on this for rate-limit-friendly polling.

**`getChildProgress(token, type, id)`** — for backends with hierarchical work items (epic → feature → story), return aggregate counts for direct children. Return `null` if the backend has no parent/child concept for this entity type, or if the user's plan doesn't include the relevant API. The UI gracefully hides the progress bar when this is `null`.

**`createItem(token, type, title, description?)`** — create a new item and return the assigned id and canonical URL. Throw a descriptive `Error` for unsupported entity types or backend failures; the route catches it and returns `502 BACKEND_ERROR` with the error message.

## The auth module

Optional. Only needed if your backend uses OAuth (or any sign-in flow that produces a per-user access token). API-key backends can skip this entirely and supply the token via `EXTERNAL_TOKEN` env or similar.

The GitHub integration is the worked example: see `api/src/auth/github.ts` for the OAuth Authorization Code flow with state CSRF, and `api/src/auth/session.ts` for iron-session cookie storage. The pattern is:

1. Mount an Express router at `/auth/<provider>` that redirects to the provider's authorize URL with a state token.
2. Handle the callback at `/auth/<provider>/callback`: validate state, exchange code for token, fetch user profile, upsert into the `users` table with `id = '<provider>:<providerId>'`, save token + user into the iron-session cookie, redirect to `/`.
3. Update `api/src/middleware/auth.ts` so the auth middleware reads the session cookie when `EXTERNAL_PROVIDER === '<your-provider>'` and populates `req.user` and `req.accessToken`.
4. Add a `POST /auth/<provider>/logout` route that destroys the session.

## Walkthrough: adding a Linear adapter

This is hypothetical but realistic. Suppose you want to integrate Linear (https://developers.linear.app).

### 1. Create the adapter file

`api/src/providers/linear-adapter.ts`:

```typescript
import type { ProviderAdapter, BackendItem, ChildProgress, ProviderEntityType } from './adapter.js';

const LINEAR_API = 'https://api.linear.app/graphql';
const TEAM_KEY = process.env.LINEAR_TEAM_KEY || '';

function headers(token: string): Record<string, string> {
  return {
    Authorization: token,           // Linear takes the raw token, no Bearer prefix
    'Content-Type': 'application/json',
  };
}

function mapIssue(node: any): BackendItem {
  return {
    entityType: 'issue',
    entityId: node.identifier,      // e.g. "MOOU-42"
    title: node.title,
    state: node.state.name.toLowerCase(),
    labels: (node.labels?.nodes ?? []).map((l: any) => ({ name: l.name, color: l.color })),
    assignee: node.assignee ? { login: node.assignee.name, avatarUrl: node.assignee.avatarUrl } : undefined,
    htmlUrl: node.url,
  };
}

export class LinearAdapter implements ProviderAdapter {
  name = 'linear';
  label = 'Linear';
  entityTypes: ProviderEntityType[] = [
    { name: 'issue', label: 'Issue', default: true },
    { name: 'project', label: 'Project' },
  ];

  async searchItems(token: string, query: string): Promise<BackendItem[]> {
    const gql = `
      query Search($q: String!, $teamKey: String!) {
        issues(filter: { team: { key: { eq: $teamKey } }, title: { contains: $q } }, first: 20) {
          nodes { id identifier title url state { name } labels { nodes { name color } } assignee { name avatarUrl } }
        }
      }`;
    const res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ query: gql, variables: { q: query, teamKey: TEAM_KEY } }),
    });
    if (!res.ok) { console.error(`Linear search failed: ${res.status}`); return []; }
    const data = await res.json() as any;
    return (data.data?.issues?.nodes ?? []).map(mapIssue);
  }

  async getItemDetails(token: string, _entityType: string, entityId: string) {
    const gql = `query ($id: String!) { issue(id: $id) { id identifier title url state { name } labels { nodes { name color } } assignee { name avatarUrl } } }`;
    const res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ query: gql, variables: { id: entityId } }),
    });
    if (!res.ok) throw new Error(`Linear API error: ${res.status} fetching ${entityId}`);
    const data = await res.json() as any;
    return { item: mapIssue(data.data.issue), etag: undefined };  // Linear doesn't use ETags
  }

  async getChildProgress(): Promise<ChildProgress | null> {
    return null;  // Linear projects have issues, but the GraphQL traversal is non-trivial — out of scope for v1
  }

  async createItem(token: string, entityType: string, title: string, description?: string) {
    if (entityType !== 'issue') throw new Error(`Linear adapter only supports creating issues, not ${entityType}`);
    const gql = `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { issue { identifier url } } }`;
    const res = await fetch(LINEAR_API, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ query: gql, variables: { input: { teamId: TEAM_KEY, title, description: description ?? '' } } }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(`Linear API error: ${res.status} — ${err.errors?.[0]?.message || 'failed to create issue'}`);
    }
    const data = await res.json() as any;
    const issue = data.data.issueCreate.issue;
    return { entityId: issue.identifier, url: issue.url };
  }
}
```

### 2. Register it

`api/src/providers/adapter.ts`:

```typescript
import { GitHubAdapter } from './github-adapter.js';
import { LinearAdapter } from './linear-adapter.js';   // ← new

const adapters: Record<string, ProviderAdapter> = {
  github: new GitHubAdapter(),
  linear: new LinearAdapter(),                          // ← new
};
```

That's it. The route layer (`api/src/routes/backend.ts`) doesn't need to change — it calls `getAdapter()` and dispatches to whichever adapter the env points to.

### 3. Add an auth module (if Linear OAuth is needed)

For per-user OAuth tokens, mirror the structure of `api/src/auth/github.ts`. For a simpler "single shared API key" deployment, set `LINEAR_API_KEY` in the environment and have your auth middleware populate `req.accessToken = process.env.LINEAR_API_KEY` for every request when `EXTERNAL_PROVIDER === 'linear'`.

### 4. Document the env vars

Add to `.env.example`:

```
EXTERNAL_PROVIDER=linear
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxx
LINEAR_TEAM_KEY=MOOU
```

### 5. Write tests

Mirror `api/src/__tests__/backend.test.ts` for the GitHub adapter:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinearAdapter } from '../providers/linear-adapter.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
process.env.LINEAR_TEAM_KEY = 'MOOU';

describe('LinearAdapter', () => {
  const adapter = new LinearAdapter();
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns mapped items from a successful search', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { issues: { nodes: [
        { id: 'a', identifier: 'MOOU-1', title: 'Fix login', url: 'https://linear.app/...', state: { name: 'Todo' }, labels: { nodes: [] }, assignee: null },
      ]}}}),
    });
    const items = await adapter.searchItems('token', 'login');
    expect(items).toHaveLength(1);
    expect(items[0]!.entityId).toBe('MOOU-1');
  });
});
```

Test the ETag-not-modified path, error handling, and `createItem` rejection of unsupported types. The GitHub adapter test is a good reference for coverage depth — match it.

## Refresh strategy

Once an outcome is connected to a backend item, moou caches the latest details in the `external_links.cached_details` JSONB column. A background job in `api/src/providers/refresh.ts` runs every 5 minutes and re-fetches links whose `fetchedAt` is older than 15 minutes, using the saved ETag for conditional requests.

The contract: your adapter's `getItemDetails` must return the literal string `'not-modified'` when it sees a 304 response. The refresh job uses that signal to avoid touching the database (and to keep counting against the rate-limit-free path on rate-limited APIs like GitHub).

Manual refresh is exposed as `POST /api/external-links/:id/refresh` and is wired into the per-link refresh button in the outcome detail panel.

## Testing checklist

For any new adapter:

- [ ] Mocked-fetch unit tests for `searchItems` (success + error path)
- [ ] Mocked-fetch unit tests for `getItemDetails` (200 + 304 + 404)
- [ ] Mocked-fetch unit tests for `getChildProgress` (returns null when not applicable, returns counts when present)
- [ ] Mocked-fetch unit tests for `createItem` (success + unsupported type rejection)
- [ ] Adapter is registered in `adapters` map and `getAdapter()` returns the right instance for the env var
- [ ] If OAuth: end-to-end auth flow tested (or manually verified) — token round-trip, session cookie persistence, logout
- [ ] Update `.env.example` with the new env vars
- [ ] Update the user-facing setup guide (`GITHUB-SETUP.md` or equivalent)

## Conventions and gotchas

**Token handling.** The `token` argument to every adapter method is whatever the auth layer puts on `req.accessToken`. For OAuth providers it's the user's bearer token. For API-key providers it's the shared key. Adapters should not assume one or the other.

**Error envelopes.** Adapters throw `Error` instances; the route layer catches them and returns `{ error: { code: 'BACKEND_ERROR', message: err.message } }` with status 502. Don't try to set status codes from inside the adapter — keep adapters HTTP-agnostic so they can be unit-tested without an Express request/response.

**Rate limits.** Most backends rate-limit aggressively. ETag conditional requests (304) typically don't count against the limit on GitHub and similar APIs — that's why the refresh strategy revolves around them. If your backend doesn't support ETags, increase the stale threshold in the refresh job for that provider.

**`getChildProgress` is opt-in.** Returning `null` is the right answer when the backend doesn't expose hierarchical work items, when the user's plan doesn't include the API, or when computing progress would be too expensive. The UI hides the progress bar entirely in that case.

**Stable entity ids.** Whatever you put in `BackendItem.entityId` is what gets stored in `external_links.entity_id` and used to fetch the item later. It must be stable for the lifetime of the link. For GitHub that's the issue number (per repo). For Linear that's the identifier (`MOOU-42`). Don't use database row ids that could change between API versions.

**No frontend changes needed.** The frontend talks to `/api/backend/*` and `/api/outcomes/:id/{connect,publish}` exclusively. Adding a new adapter is a backend-only change as long as you reuse the existing entity-type model.
