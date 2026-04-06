---
status: pending
priority: p3
issue_id: "016"
tags: [code-review, security]
---

# Markdown Export Has No Output Encoding

## Findings
- api/src/routes/export.ts lines 274-323: user data interpolated into markdown

## Proposed Solutions
1. Escape markdown special characters in user content. Effort: Small.
