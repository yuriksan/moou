---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, performance]
---

# Sequential N+1 Score Recalculation

## Problem Statement
recalculateAll() runs one UPDATE per motivation then one SELECT+UPDATE per outcome. O(N+M) sequential queries.

## Findings
- api/src/scoring/recalculate.ts lines 86-101

## Proposed Solutions
1. Batch motivation scores in JS, single bulk UPDATE. Compute outcome scores via GROUP BY query. Effort: Medium.

## Acceptance Criteria
- [ ] recalculateAll completes in <1 second for 100 motivations + 50 outcomes
