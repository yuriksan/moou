---
status: pending
priority: p1
issue_id: "002"
tags: [code-review, security]
---

# Import Apply Trusts Client-Submitted Diffs

## Problem Statement
POST /import/timeline/apply accepts a client-submitted array of DiffItem objects and applies them directly. A malicious client can fabricate diffs with arbitrary entityId values, modifying or deleting any entity.

## Findings
- Location: api/src/routes/import.ts lines 194-287
- Changes object applied without field validation (status, effort not checked against enums)
- No server-side re-verification that the diffs match the uploaded spreadsheet

## Proposed Solutions
1. **Server-side session** — Store computed diffs in a temp table keyed by session token. Apply endpoint references stored diffs, not client-submitted ones. Effort: Medium. Risk: Adds state management.
2. **Re-verify on apply** — Re-upload the spreadsheet and re-compute diffs, compare against submitted selection. Effort: Medium. Risk: Requires re-upload.
3. **Validate field values** — At minimum, validate all enum fields against allowed values before applying. Effort: Small. Risk: Partial fix only.

## Acceptance Criteria
- [ ] Cannot apply diffs targeting entities not in the original upload
- [ ] Field values validated against allowed enums
- [ ] Applied changes match what was shown in the diff review
