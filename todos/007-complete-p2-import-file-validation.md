---
status: pending
priority: p2
issue_id: "007"
tags: [code-review, security]
---

# Import Endpoint Has No File Validation or Resource Limits

## Problem Statement
POST /import/timeline/diff accepts 10MB raw binary with no validation that it's actually XLSX. No limits on rows/sheets processed. Zip bomb risk.

## Findings
- api/src/app.ts line 24: raw body middleware accepts type '*/*'
- api/src/routes/import.ts: no magic byte check, no row limit

## Proposed Solutions
1. Validate ZIP magic bytes, limit to 50 sheets and 10K rows per sheet. Effort: Small.

## Acceptance Criteria
- [ ] Non-XLSX files rejected with 400
- [ ] Oversized spreadsheets handled gracefully
