---
status: pending
priority: p2
issue_id: "011"
tags: [code-review, quality]
---

# Pervasive `any` Typing in Frontend

## Problem Statement
useApi.ts returns `any` for almost every method. Views use `ref<any[]>()`. This negates TypeScript safety.

## Findings
- app/src/composables/useApi.ts: every request<any>
- All views: ref<any[]>, ref<any>

## Proposed Solutions
1. Use shared types in API client return types and component refs. Effort: Medium.

## Acceptance Criteria
- [ ] API client methods return properly typed responses
- [ ] Component refs use specific types instead of any
