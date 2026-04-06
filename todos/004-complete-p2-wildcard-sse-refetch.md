---
status: pending
priority: p2
issue_id: "004"
tags: [code-review, performance]
---

# Wildcard SSE Listener Causes Redundant API Refetches

## Problem Statement
Views subscribe to `on('*', () => loadData())` which fires on every SSE event type. A motivation update triggers a full outcomes reload. During bulk operations (import apply), this causes a burst of redundant API calls.

## Findings
- OutcomesView.vue line 39, MotivationsView.vue line 34, TimelineView.vue
- Every event type triggers full data reload in every view

## Proposed Solutions
1. Subscribe to specific event types per view (e.g. `on('outcome_updated', loadOutcomes)`)

## Acceptance Criteria
- [ ] Views only refetch when relevant entity types change
- [ ] Import apply does not cause excessive API calls
