---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, security, quality]
---

# No Input Validation on Enums, Lengths, Formats

## Problem Statement
Most route handlers only check required fields exist. Enum values (status, effort, type), string lengths, UUID formats, date formats, and URL formats are not validated at the route level. Invalid values hit DB CHECK constraints and produce 500 errors instead of clean 400s.

## Findings
- Outcomes: effort, status not validated
- Milestones: type, status, targetDate format not validated
- Tags: colour format not validated
- All routes: tagIds not validated as UUID array
- Comments: no max length on body

## Proposed Solutions
1. Add zod schemas per route for request body validation. Effort: Medium.

## Acceptance Criteria
- [ ] Invalid enum values return 400 with descriptive message
- [ ] Oversized strings are rejected
- [ ] Invalid UUIDs return 400
