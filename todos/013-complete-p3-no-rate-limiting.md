---
status: complete
priority: p3
issue_id: "013"
tags: [code-review, security]
---

# No Rate Limiting on Any Endpoint

## Proposed Solutions
1. Add express-rate-limit. Global 100/min, mutations 30/min, recalculate 1/5min. Effort: Small.
