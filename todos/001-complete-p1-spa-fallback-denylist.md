---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, architecture]
---

# SPA Fallback Route Denylist Will Break Silently

## Problem Statement
The SPA fallback in api/src/app.ts uses a hardcoded list of API path prefixes to skip. When a new API route is added, if the denylist is not updated, GET requests to the new route will return index.html instead of JSON.

## Findings
- Location: api/src/app.ts lines 76-84
- The list already has 13 prefixes and will grow with every new feature
- No test catches this — a forgotten prefix silently breaks the API

## Proposed Solutions
1. **Prefix all API routes under /api/** — SPA fallback checks `!req.path.startsWith('/api')`. Eliminates the denylist entirely. Effort: Medium. Risk: Breaking change for frontend API client URLs.
2. **Check Accept header** — If request accepts JSON, treat as API. If accepts HTML, serve SPA. Effort: Small. Risk: May not work for all clients.

## Acceptance Criteria
- [ ] New API routes do not require updating a denylist
- [ ] Existing API routes continue to return JSON
- [ ] SPA routes (/, /timeline, /outcomes, etc.) serve index.html
