---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, security]
---

# SSE Endpoint Has No Connection Limits

## Problem Statement
GET /events accepts unlimited connections with no auth, per-IP limits, or timeout. An attacker can exhaust server resources.

## Findings
- api/src/sse/emitter.ts — unbounded Set<Response>
- No per-IP limit, no max connections, no timeout
- GET bypass means no auth required

## Proposed Solutions
1. Max 100 total connections, max 5 per IP, 30-minute timeout. Effort: Small.

## Acceptance Criteria
- [ ] Connection limit enforced
- [ ] Per-IP limit enforced
- [ ] Connections timeout after 30 minutes
