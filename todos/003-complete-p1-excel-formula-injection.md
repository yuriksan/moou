---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, security]
---

# Excel Export Vulnerable to Formula Injection

## Problem Statement
The Excel export writes user-supplied data directly into cells. If a field starts with =, +, -, @, it will be interpreted as a formula when opened in Excel, enabling command execution or data exfiltration.

## Findings
- Location: api/src/routes/export.ts lines 148-270
- Outcome titles, descriptions, motivation titles, and attribute values are all written raw
- An attacker creates a motivation titled `=CMD|'/C calc'!A1` — any user opening the export gets RCE

## Proposed Solutions
1. **Prefix dangerous cells** — Prepend a single quote to cells starting with =, +, -, @, \t, \r. Effort: Small. Risk: Visible quote character in exported data.
2. **Set cell type to string** — Force all cells to ExcelJS ValueType.String. Effort: Small. Risk: Numbers won't be formatted as numbers.
3. **Sanitize on write** — Strip formula characters from the beginning of cell values. Effort: Small. Risk: May truncate legitimate content starting with those characters.

## Acceptance Criteria
- [ ] Cells starting with = + - @ are not interpreted as formulas
- [ ] Exported data is still human-readable
- [ ] Numeric values remain usable
