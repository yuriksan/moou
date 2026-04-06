---
status: pending
priority: p2
issue_id: "009"
tags: [code-review, architecture]
---

# Multiple SSE Connections Created Per Page

## Problem Statement
Each view calling useSSE() creates a new EventSource. Child components (OutcomeDetail inside TimelineView) create additional connections.

## Findings
- app/src/composables/useSSE.ts creates connection in constructor
- TimelineView + OutcomeDetail = 2 simultaneous connections

## Proposed Solutions
1. Singleton SSE composable provided from App.vue. Effort: Small.

## Acceptance Criteria
- [ ] Only one EventSource connection at any time
