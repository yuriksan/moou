---
status: pending
priority: p3
issue_id: "015"
tags: [code-review, security]
---

# Auth Error Message Leaks User ID Existence

## Findings
- api/src/middleware/auth.ts line 47: "Unknown user: {userId}"

## Proposed Solutions
1. Generic message: "Authentication failed". Effort: Small.
