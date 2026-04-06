---
title: Timeline drag-and-drop (move outcomes between milestones)
type: feat
status: approved
date: 2026-04-06
---

# Timeline drag-and-drop — move outcomes between milestones

## Goal

Let users reschedule outcomes by dragging cards between milestone columns or to/from the backlog on the Timeline view. Manual reordering within a column is explicitly out of scope — priority score remains the source of truth for in-column order.

## User-facing behaviour

- Every outcome card on the Timeline view (in any milestone column or in the Backlog) is draggable.
- A drag from any source to any target reassigns the outcome's `milestoneId`:
  - Card → another milestone column → `milestoneId` set to that milestone's id
  - Card → backlog → `milestoneId` set to `null`
  - Card → its current container → no-op (no API call)
- During a drag the source card dims (`opacity: 0.4`) and the hovered drop target gets a highlighted border (`border-color: var(--accent)`) so it's clear where the card will land.
- Click-vs-drag is handled by the browser: a click that doesn't move past the system threshold fires `@click` (selection), otherwise fires `dragstart` (drag). Same card serves both interactions — no separate drag handle.
- The right-side detail panel stays open while dragging the same outcome it shows.

## Architecture

- **Native HTML5 drag-and-drop** (`draggable="true"`, `dragstart`, `dragover`, `drop`, `dragend`). No new dependency.
- **State:** a single `draggingOutcomeId` ref in `TimelineView.vue`. Set on `dragstart`, cleared on `dragend`. Used to apply the `.dragging` class to the source card and to know which outcome to update on drop.
- **Drop targets:** the `.milestone-cards` container of each milestone, plus the `.backlog-cards` container. The whole column is the drop zone — *not* individual cards. We don't need per-position drop indicators because we're not reordering.
- **Optimistic update:** on drop, the local `outcomes.value` array is rewritten in-place so the card visually moves immediately. The `PUT /api/outcomes/:id` fires in parallel.
- **Error handling:** if the PUT fails, the existing useApi toast surfaces the error and `loadData()` is called to revert the local state from the server.
- **SSE:** the existing `outcome_updated` broadcast already triggers a refresh on other connected clients — no new event needed.

## API

No new endpoints. Reuses `PUT /api/outcomes/:id` with body `{ milestoneId }` (or `{ milestoneId: null }` for backlog).

## Edge cases

| Case | Behaviour |
|---|---|
| Drop on the same column as the source | No-op, no API call |
| Drop outside any drop target | `dragend` cleans up state, no API call |
| API failure | Toast (existing) + `loadData()` to revert local state |
| Filtered Timeline (tag filter active) | Optimistic update places the card; the next `loadData()` respects the filter |
| Drag of currently-selected outcome | Detail panel stays open and follows the outcome |

## Out of scope (deliberately)

- Within-milestone reordering (would require a `position` column and re-architected sort)
- Touch / mobile DnD (HTML5 DnD has no native touch — would need a library)
- Multi-select drag
- Animation between positions
- Dragging milestones themselves to reorder columns

## Tests

`app/src/__tests__/TimelineViewDnD.test.ts` — new file.

| Test | Assertion |
|---|---|
| Drag a card from one milestone column and drop on another | `api.updateOutcome` called with the new `milestoneId`; the local card is in the target column |
| Drag a card from a milestone and drop on the backlog | `api.updateOutcome` called with `milestoneId: null` |
| Drop on the same column as the source | `api.updateOutcome` is NOT called |

## Files touched

- `app/src/views/TimelineView.vue` — script: `draggingOutcomeId` ref, `onDragStart`, `onDragOver`, `onDrop`, `onDragEnd` handlers; template: `draggable`, drag/drop event bindings, `.dragging` class on the source card, `.drop-target-active` class on the hovered container; scoped CSS for the new classes
- `app/src/__tests__/TimelineViewDnD.test.ts` — new test file
- `docs/SPEC.md` — short note in the workflow section about drag-to-reschedule
