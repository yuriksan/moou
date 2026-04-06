---
title: "Backend Sync — Connect, Publish, Progress Tracking"
type: feat
status: active
date: 2026-04-06
origin: docs/brainstorms/2026-04-06-backend-sync-requirements.md
---

# Backend Sync — Connect, Publish, Progress Tracking

## Overview

Build the bidirectional sync layer between moou and issue backends (GitHub first, architecture supports ValueEdge/Jira/Linear). Outcomes can be connected to existing backend items or published as new ones. Connected items show live status, progress (child items completed), and freshness timestamps. Users control when data crosses the boundary.

Supersedes the read-only Phase 2-4 from the previous plan. Phase 1 (GitHub OAuth) is complete and tested.

## Origin

**Requirements:** [docs/brainstorms/2026-04-06-backend-sync-requirements.md](../brainstorms/2026-04-06-backend-sync-requirements.md)

Key decisions carried forward:
- Three states: Draft / Connected / Published (see origin R1)
- User controls sync boundary (see origin R2)
- moou milestones ≠ backend milestones — no sync (see origin R10)
- Search-first for connecting (resolved question)
- Backend authoritative for execution data, moou for prioritisation

## Schema Changes

```sql
-- Add to external_links table
ALTER TABLE external_links ADD COLUMN connection_state TEXT NOT NULL DEFAULT 'connected'
  CHECK (connection_state IN ('connected', 'published'));

-- cached_details JSONB already exists (added in Phase 1)
-- Structure:
-- {
--   title: string,
--   state: string,          -- open/closed/merged/done/in-progress/new
--   stateReason: string?,   -- completed/not_planned (GitHub), null otherwise
--   labels: [{name, color}],
--   assignee: {login, avatarUrl}?,
--   milestone: {title, dueOn}?,
--   htmlUrl: string,
--   childProgress: {total: number, completed: number, inProgress: number}?,
--   etag: string?,          -- for conditional refresh
--   fetchedAt: string,      -- ISO timestamp
-- }
```

Outcomes get an implicit connection state derived from their links:
- **Draft** — no external links
- **Connected** — has links with `connection_state = 'connected'`
- **Published** — has links with `connection_state = 'published'`
- Mixed states possible (one connected, one published)

## Provider Interface

Each provider implements this interface (TypeScript):

```typescript
interface ProviderAdapter {
  // Identity
  name: string;                    // 'github', 'valueedge', 'jira'
  label: string;                   // 'GitHub', 'OpenText ValueEdge'

  // Entity types the user can connect/publish to
  entityTypes: { name: string; label: string; default?: boolean }[];
  // GitHub: [{name:'issue', label:'Issue', default:true}, {name:'pr', label:'Pull Request'}]
  // ValueEdge: [{name:'feature', label:'Feature', default:true}, {name:'story', label:'Story'}, {name:'epic', label:'Epic'}]

  // Search backend items by query string
  searchItems(token: string, query: string, entityType?: string): Promise<BackendItem[]>;

  // Get full details of a single item (with ETag support)
  getItemDetails(token: string, entityType: string, entityId: string, etag?: string): Promise<{item: BackendItem, etag?: string} | 'not-modified'>;

  // Get child item progress (e.g. stories under a feature)
  getChildProgress(token: string, entityType: string, entityId: string): Promise<{total: number, completed: number, inProgress: number} | null>;

  // Create a new item in the backend
  createItem(token: string, entityType: string, title: string, description?: string): Promise<{entityId: string, url: string}>;
}

interface BackendItem {
  entityType: string;
  entityId: string;
  title: string;
  state: string;
  stateReason?: string;
  labels: Array<{name: string, color?: string}>;
  assignee?: {login: string, avatarUrl?: string};
  milestone?: {title: string, dueOn?: string};
  htmlUrl: string;
}
```

## Implementation Phases

### Phase 2: GitHub Provider Adapter + Search API

- [ ] Create `api/src/providers/github-adapter.ts` implementing `ProviderAdapter`
  - `searchItems()` — calls `GET /search/issues?q={query}+repo:{owner}/{repo}` with user's OAuth token
  - `getItemDetails()` — calls `GET /repos/{owner}/{repo}/issues/{number}` or `/pulls/{number}`, supports `If-None-Match` with ETag
  - `getChildProgress()` — for GitHub issues, count sub-issues (via `GET /repos/{owner}/{repo}/issues/{number}/sub_issues` or timeline events). Return null if no sub-issues concept available.
  - `createItem()` — calls `POST /repos/{owner}/{repo}/issues` with title + body. Returns issue number + URL.
- [ ] Create `api/src/providers/adapter.ts` — registry that returns the correct adapter based on `EXTERNAL_PROVIDER`
- [ ] Add `connection_state` column to `external_links` schema
- [ ] Create `GET /api/github/search?q=term&type=issue` — proxies to GitHub search via adapter, requires auth
- [ ] Update `POST /api/outcomes/:id/external-links` — when provider is GitHub:
  - Validate item exists via `getItemDetails()`
  - Cache full details as JSONB (`cached_details`)
  - Set `connection_state` to 'connected'
- [ ] Create `api/src/providers/refresh.ts` — refresh stale cached details:
  - `refreshLink(linkId)` — fetch with ETag, update if changed, update `fetchedAt`
  - `refreshStaleLinks(maxAgeMinutes)` — find links where `fetchedAt` is older than threshold
- [ ] Wire `refreshStaleLinks(15)` into a 5-minute cron interval (checks every 5 min, refreshes items older than 15 min)
- [ ] Tests: search (mocked), detail fetch (mocked), ETag 304 handling, stale refresh

**Done when:** Can search GitHub issues from API, connect one to an outcome, see cached details with fetchedAt timestamp, details auto-refresh when stale.

### Phase 3: Frontend — Connect Flow + Status Display

- [ ] Update `app/src/App.vue` — auth-aware:
  - On mount: `GET /api/me` — if 401 and provider is GitHub, show login button
  - If authenticated: display GitHub avatar + name, logout option
  - If mock mode: keep user switcher
- [ ] Create `app/src/components/ConnectDialog.vue`:
  - Search input with debounce
  - Results list showing: issue number, title, status badge, labels, assignee
  - Entity type selector (issue/PR for GitHub)
  - Click to connect
- [ ] Update `app/src/components/OutcomeDetail.vue` — external links section:
  - Connected/published items show rich details: title, status badge (coloured by state), labels as chips, assignee avatar, backend milestone name, direct link
  - **Progress bar** if `childProgress` exists: "3/7 done" with visual bar
  - **Freshness timestamp**: "Updated 5 min ago" / "Stale — refreshing..."
  - **Manual refresh button** per link
  - **Connection state badge**: "Connected" / "Published"
  - "Connect to Issue" button opens ConnectDialog
  - "Disconnect" button (with confirmation — does NOT delete backend item)
- [ ] Add `useApi` methods: `searchBackendItems(query, type)`, `refreshLink(linkId)`
- [ ] Tests: ConnectDialog rendering, status display, progress bar

**Done when:** User can search GitHub issues, connect one, see its title + status + labels + progress inline, see freshness timestamp, manually refresh.

### Phase 4: Publish Flow (moou → GitHub) ✅

- [x] Create `POST /api/outcomes/:id/publish` endpoint:
  - Requires auth
  - Body: `{ entityType: 'issue' }` (defaults to provider's default)
  - Calls `adapter.createItem()` with outcome title + description
  - Creates external link with `connection_state: 'published'`
  - Caches the created item's details (with ETag + fetchedAt)
  - Records history, broadcasts SSE
- [x] Add "Publish as Issue" button in OutcomeDetail — only visible when the outcome is in the implicit Draft state (no external links)
  - Entity type dropdown when the provider exposes more than one publishable type; PRs are filtered out (cannot be created from title + description alone)
  - Confirmation message uses provider label: "This will create a new GitHub issue"
  - After publish: link appears immediately with "Published" badge (rendered by `ExternalLinkCard`)
- [x] Tests:
  - Backend: publish with default entity type, publish with explicit entity type, PR rejection, 404 on missing outcome (`api/src/__tests__/backend-routes.test.ts`)
  - Backend: GitHub adapter `createItem` rejects PRs (`api/src/__tests__/backend.test.ts`)
  - Frontend: button gating (draft vs connected), provider label in copy, entity type rendering, confirmation flow, cancellation (`app/src/__tests__/OutcomeDetailPublish.test.ts`)

**Done when:** User clicks "Publish as GitHub" on a draft outcome, a GitHub issue is created, the outcome shows it as "Published" with live status. ✅

### Phase 5: Documentation + Tests + Docs ✅

- [x] Create `docs/INTEGRATIONS.md` — developer guide:
  - Provider adapter interface
  - How to add a new provider (auth module + adapter)
  - GitHub adapter as reference implementation
  - Entity type mapping
  - Refresh strategy (ETag, stale threshold)
  - Testing approach
- [x] Create `docs/GITHUB-SETUP.md` — user guide:
  - Creating a GitHub OAuth App (step-by-step)
  - Required env vars
  - Docker deployment with GitHub auth
  - Connecting outcomes to issues
  - Publishing outcomes as issues
  - Troubleshooting
- [x] Update `docs/DECISIONS.md` — ADR-014: Backend sync architecture
- [x] Update `docs/SPEC.md` — External system integration section
- [x] Update `README.md` — GitHub integration section
- [x] Integration tests with mocked GitHub API for full connect + publish + refresh flow (`api/src/__tests__/backend-e2e.test.ts`)

**Done when:** Developer can read INTEGRATIONS.md and understand how to add a new provider. User can follow GITHUB-SETUP.md from scratch. ✅

## Acceptance Criteria

### Connect Flow (R5, R6)
- [ ] User searches GitHub issues by typing a query
- [ ] Results show issue number, title, status, labels, assignee
- [ ] User selects an issue to connect it to an outcome
- [ ] Connected issue shows inline with full details

### Status Display (R4)
- [ ] Title, status badge (open/closed/merged), labels, assignee displayed
- [ ] Backend milestone shown as read-only context
- [ ] Status colour-coded per state
- [ ] Progress bar for items with children ("3/7 stories done")

### Freshness (R7)
- [ ] Each connected item shows "Updated X min ago"
- [ ] Stale items (>15 min) auto-refresh in background
- [ ] Manual "Refresh" button per link
- [ ] ETag conditional requests — 304 responses don't count against rate limit

### Publish Flow (R7, R8, R9)
- [ ] "Publish as Issue" button on draft outcomes
- [ ] User picks entity type (issue/PR/feature/story)
- [ ] GitHub issue created with outcome title + description
- [ ] Link auto-established with "Published" badge
- [ ] Unpublished outcomes can be deleted/reorganised freely

### Entity Type Flexibility
- [ ] Provider defines available entity types
- [ ] User selects type when connecting or publishing
- [ ] Different types return different state vocabularies (handled by display layer)

### Provider Interface (R12)
- [ ] GitHub adapter implements the full interface
- [ ] Adapter registry returns the correct adapter based on config
- [ ] New providers can be added by implementing the interface

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| GitHub `repo` scope is broad | Documented in user guide. Only OAuth Apps option for private repos. |
| GitHub rate limits (5000/hr) | ETag conditional requests. 304 = free. Monitor via response headers. |
| GitHub sub-issues API may not exist for all repos | Return null for childProgress. Display "N/A" gracefully. |
| ValueEdge phases vary by workspace | Adapter returns raw state string. Display layer maps to colours generically. |
| Large repos with thousands of issues | Search-first (not browse). Limit results to 20. Debounce queries. |

## Sources

- **Origin:** [docs/brainstorms/2026-04-06-backend-sync-requirements.md](../brainstorms/2026-04-06-backend-sync-requirements.md)
- **Previous plan:** [docs/plans/2026-04-06-002-feat-github-oauth-integration-plan.md](2026-04-06-002-feat-github-oauth-integration-plan.md) — Phase 1 complete
- **GitHub Issues API:** https://docs.github.com/en/rest/issues/issues
- **GitHub Search API:** https://docs.github.com/en/rest/search/search
- **GitHub Milestones API:** https://docs.github.com/en/rest/issues/milestones
- **ValueEdge REST API:** https://admhelp.microfocus.com/valueedge/en/latest/Online/Content/API/articles_API2.htm
- **ValueEdge Node SDK:** https://www.npmjs.com/package/@microfocus/alm-octane-js-rest-sdk
- **iron-session v8:** https://github.com/vvo/iron-session (Phase 1 complete)
- **ETag best practices:** https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api
