---
date: 2026-04-06
topic: backend-sync
---

# Bidirectional Sync Between moou and Issue Backends

## Problem Frame

moou and the issue backend (GitHub, ValueEdge, Jira) have overlapping concepts: outcomes ↔ issues, milestones ↔ releases/milestones. Maintaining parallel structures creates duplication and sync burden. Teams need flexibility: some start planning in moou then publish to the backend, others have years of existing issues and want to connect motivations to them. The sync must be opt-in, directional, and respect that backends may not allow easy deletion.

## Context

- **GitHub** has issues, PRs, milestones, labels. Full CRUD API. Issues can be freely created and closed.
- **ValueEdge** (ALM Octane) has epics, features, stories, defects, releases, milestones, sprints. Full REST API. Work item hierarchy: epic → feature → story. Node.js SDK available (`@microfocus/alm-octane-js-rest-sdk`). Some entities (epics) may not be easily deletable in practice.
- **moou Phase 1 auth** is complete: GitHub OAuth with iron-session works. User identity is provider-agnostic (`github:12345`, `mock:sarah-chen`).

## Requirements

### Outcome ↔ Backend Item Relationship

- R1. **Three relationship states** — An outcome's relationship to the backend has an explicit state:
  - **Draft** — outcome exists only in moou. No backend representation. Safe to delete, rename, reorganise.
  - **Connected** — outcome is linked to an existing backend item. Backend data (title, status, labels, assignee) displayed in moou. Backend is authoritative for that data.
  - **Published** — moou created the backend item from the outcome. Initially synced from moou, then backend becomes authoritative for execution-level data (status, assignee).

- R2. **User controls when data crosses the boundary** — Nothing syncs automatically. The user explicitly chooses to:
  - "Connect" an outcome to an existing backend item (browse/search/paste)
  - "Publish" an outcome to create a new backend item
  - "Disconnect" an outcome (removes the link, does not delete the backend item)

- R3. **One outcome, many backend items** — An outcome like "Improve Masking Performance" may map to multiple issues/stories. Each link carries its own cached details and state.

- R4. **Backend data displayed inline** — Connected/published outcomes show the backend item's title, status (open/closed/merged/done), labels/tags, assignee, and a direct link. This data is cached and refreshed periodically (ETag-based, ~15 min stale threshold).

### Connecting to Existing Backend Items

- R5. **Browse/search backend items from moou** — When connecting, the user can search the backend's issues by title/number. Results show in a searchable list within moou. The user selects one to connect.

- R6. **Support for existing historical data** — Teams with hundreds of existing issues can browse them from moou and selectively attach motivations. moou does not require importing everything — only items the user explicitly connects.

### Publishing from moou to Backend

- R7. **Publish creates a backend item** — When publishing, moou creates an issue/epic/feature in the backend from the outcome's title and description. The link is established automatically.

- R8. **Delay publishing until ready** — Users can plan extensively in moou (create outcomes, attach motivations, score, organise by milestone) without anything touching the backend. Publishing is a deliberate action when the user is comfortable.

- R9. **Published items respect backend constraints** — If the backend doesn't easily allow deletion (e.g. ValueEdge epics), this is documented and the user understands that publishing is a one-way creation. Disconnecting removes the moou link but does not delete the backend item.

### Milestones

- R10. **moou milestones are planning containers, not synced** — moou milestones (Q3 Release, SOC2 Audit) serve prioritisation and timeline planning. They may or may not correspond to a backend release/milestone. No automatic sync between moou milestones and backend milestones.

- R11. **Backend milestone/release visible on connected items** — If a connected GitHub issue has a milestone, or a ValueEdge story is in a release, that information is displayed in moou for context. But moou does not create or modify backend milestones.

### Provider Interface

- R12. **Each provider implements a standard interface** — Auth module (OAuth flow, token management), API client (search items, get item details, create item), entity type mapping. New providers are added by implementing this interface and registering in providers.ts.

## Success Criteria

- A team with 200 existing GitHub issues can browse them from moou and connect motivations to selected ones
- A PM can plan 10 outcomes in moou, score them, then publish the top 5 to GitHub as issues — with the other 5 remaining as drafts
- Connected items show live status from the backend (closed/merged reflects automatically)
- Disconnecting an outcome does not delete the backend item
- A developer can read the docs and implement a new provider following the GitHub example

## Scope Boundaries

- **No automatic bidirectional field sync** — moou doesn't update backend item titles when the outcome title changes, or vice versa. Display is read-from-backend, actions are explicit.
- **No webhook-driven sync** — poll-based refresh only (v2 for webhooks)
- **No bulk import** — connect items one at a time (v2 for bulk)
- **Single repo/workspace per deployment** — configured via env vars
- **No milestone sync** — milestones are independent in moou and the backend

## Key Decisions

- **Outcomes ≠ issues** — They are different concepts that can be linked, not mirrored. An outcome is "why" + prioritisation; an issue is "what to do" + execution.
- **User-controlled sync boundary** — Nothing crosses automatically. Draft → Connected/Published is always a deliberate action.
- **Backend is authoritative for execution data** — Once connected/published, status/assignee/labels come from the backend.
- **moou is authoritative for prioritisation data** — Motivations, scores, milestones, tags live in moou regardless of connection state.
- **No deletion pressure** — Disconnecting ≠ deleting. Backend items persist independently.

## Outstanding Questions

### Resolved

- [R5] **Search-first** — user types a search term, moou queries GitHub Issues API, shows matches. No browse-all.
- [R10/R11] **No milestone sync** — research confirmed providers have incompatible milestone models (GitHub: per-repo, ValueEdge: per-workspace + release-tied). moou milestones stay independent. Backend milestones shown as read-only context on connected items.
- [R10] **No tag/UDF-based milestone mapping** — tags have no dates, are workspace-scoped in ValueEdge, and keeping them in sync is fragile. Not worth the complexity.

### Deferred to Planning

- [Affects R7][Technical] What fields to include when publishing (title, description, labels from tags?)
- [Affects R12][Technical] Exact interface shape for the provider adapter
- [Affects R4][Needs research] How to handle ValueEdge auth (API key + cookie) alongside GitHub OAuth in the same codebase
- [Affects R12][Technical] Provider `listMilestones()` for the optional publish-to-milestone flow (v2)

## Next Steps

→ `/ce:plan` — no blocking questions remain
