---
status: complete
priority: p3
issue_id: "012"
tags: [code-review, security]
---

# Search ILIKE Pattern Not Escaped

## Problem Statement
Search query wraps user input with % without escaping LIKE metacharacters (% and _).

## Findings
- api/src/routes/search.ts line 11

## Proposed Solutions
1. Escape % and _ before constructing pattern. Effort: Small.
