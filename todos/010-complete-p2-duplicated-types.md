---
status: pending
priority: p2
issue_id: "010"
tags: [code-review, architecture]
---

# Duplicated Types Between shared/ and api/src/types.ts

## Problem Statement
shared/src/types.ts and api/src/types.ts are identical 163-line files. Changes to one will not automatically propagate to the other.

## Findings
- Both files contain identical entity interfaces, enums, and constants
- api/ imports from its local copy, not from shared/

## Proposed Solutions
1. Delete api/src/types.ts, import from shared/ via workspace resolution. Effort: Small.

## Acceptance Criteria
- [ ] Single source of truth for type definitions
- [ ] Both api/ and app/ import from the same file
