# Brainstorm: Surfacing Linked Issue Progress

## Problem Statement

An outcome may link to one or more backend work items (epics, features, stories). We want to show **progress on an outcome** by understanding how many work items are defined and what state they are in. This is complex because:

1. Links can point to **different levels of the hierarchy** (epic, feature, story)
2. Epics and features are **containers** — their real progress lives in their children/grandchildren
3. A user might accidentally link to **both an epic AND a feature inside that epic**, causing double-counting
4. Different backends (VE, GitHub) have **different hierarchies, phases, and semantics**
5. Deep hierarchy traversal requires **multiple API calls** with caching implications

---

## Current State

### What exists today

- `getChildProgress(entityType, entityId)` → `{ total, completed, inProgress }` — **one level deep only**
- Epic → counts features; Feature → counts stories; Story → returns null
- Phase classification is simple string matching:
  - **Completed**: phase name ∈ {"done", "closed", "accepted"}
  - **In Progress**: everything except completed + {"new", "backlog"}
  - **Not Started**: {"new", "backlog"}
- ExternalLinkCard renders a green progress bar: `completed/total done`
- No aggregation across multiple links on the same outcome
- No overlap detection

### Gaps

| Gap | Impact |
|-----|--------|
| Epic link only shows feature-level progress, not story-level | Misleading — 2/5 features "done" doesn't mean 40% of stories are done |
| No aggregation across links | Outcome with 3 linked features shows 3 separate bars, no combined view |
| No overlap detection | Link to Epic + Feature-in-Epic double-counts the feature's stories |
| Phase mapping is hardcoded | Custom VE phases or additional backends will break silently |
| No "blocked" or "rejected" awareness | Can't surface items stuck in problematic states |

---

## VE Phase Semantics Deep Dive

### Known Phase Logical Names

VE phases follow the pattern `phase.{entityType}.{state}`. From our data and VE documentation:

#### Epics
| Phase | Meaning | Progress Bucket |
|-------|---------|-----------------|
| `phase.epic.new` | Not started | **Not Started** |
| `phase.epic.inprogress` | Work underway | **In Progress** |
| `phase.epic.done` | Completed | **Done** |

#### Features
| Phase | Meaning | Progress Bucket |
|-------|---------|-----------------|
| `phase.feature.new` | Not started | **Not Started** |
| `phase.feature.inprogress` | Development active | **In Progress** |
| `phase.feature.done` | Completed | **Done** |

#### User Stories
| Phase | Meaning | Progress Bucket |
|-------|---------|-----------------|
| `phase.story.new` | Backlog | **Not Started** |
| `phase.story.inprogress` | In development | **In Progress** |
| `phase.story.intesting` | In QA/testing | **In Progress** (or separate bucket?) |
| `phase.story.done` | Completed | **Done** |

#### Defects (if we support them later)
| Phase | Meaning | Progress Bucket |
|-------|---------|-----------------|
| `phase.defect.new` | Reported | **Not Started** |
| `phase.defect.opened` | Confirmed/triaged | **In Progress** |
| `phase.defect.fixed` | Fix applied | **In Progress** |
| `phase.defect.proposeclose` | Awaiting verification | **In Progress** |
| `phase.defect.closed` | Verified closed | **Done** |
| `phase.defect.deferred` | Won't fix / deferred | **Excluded?** |
| `phase.defect.duplicate` | Duplicate | **Excluded** |
| `phase.defect.rejected` | Not a bug | **Excluded** |

### Key Insight: Custom Phases

VE workspaces can define **custom phases** and **sub-phases**. Our phase classification MUST be resilient to unknown values. Options:

- **A)** Query the `/phases` endpoint to build a dynamic mapping at connection time
- **B)** Use the `metaphase` field if available (groups phases into high-level categories)
- **C)** Default unknown phases to "In Progress" (safe assumption: if it's not new/done, it's in progress)
- **Recommendation**: Option C with a fallback log, upgrade to A if we encounter real custom phases

---

## Design Decisions Needed

### Decision 1: What level do we count?

When an outcome links to an **Epic**, what constitutes "a work item" for progress?

| Option | Counts | Pro | Con |
|--------|--------|-----|-----|
| **A) Direct children only** (current) | Features under epic | Simple, one API call | Misleading — a feature could be "in progress" with 0/20 stories done |
| **B) Leaf items only** | Stories under features under epic | Most accurate | Multiple API calls; stories might not exist yet for future features |
| **C) All descendants, weighted** | Features + stories, features worth more | Nuanced | Complex to explain; confusing UI |
| **D) Configurable per link** | User chooses depth | Flexible | UI complexity; users won't understand |

**Recommendation**: **B with fallback to A**.
- If a feature has stories → count stories
- If a feature has NO stories → count the feature itself (it's likely not yet decomposed)
- This gives the most honest picture while handling partially-planned work

### Decision 2: How to handle overlap / deduplication

If Outcome links to Epic-123 AND Feature-456 (which is a child of Epic-123):

| Option | Behavior |
|--------|----------|
| **A) Detect and warn** | Show a warning: "Feature-456 is already included via Epic-123" |
| **B) Auto-deduplicate** | Silently remove Feature-456's items from Epic-123's rollup |
| **C) Show both, mark overlap** | Show both links with their progress, but annotate the overlap |
| **D) Prevent at link time** | When connecting, warn: "This feature is already covered by linked Epic-123" |

**Recommendation**: **D + C**. Prevent at link time (soft warning, not a block), and if overlap exists, annotate it in the UI. Full dedup is hard to get right silently.

### Decision 3: Aggregated outcome-level progress

Should we show a **single combined progress bar** for the outcome across all its links?

| Option | Behavior |
|--------|----------|
| **A) Per-link only** (current) | Each ExternalLinkCard shows its own progress |
| **B) Outcome-level rollup** | A single bar at the top of the outcome: "23/45 items done across 3 linked epics" |
| **C) Both** | Outcome-level summary + expandable per-link detail |

**Recommendation**: **C**. Show a summary bar in the outcome header/card, with per-link detail in the detail view.

### Decision 4: Phase granularity in the UI

How much phase detail to show?

| Option | Display |
|--------|---------|
| **A) Binary** | Done / Not Done (current progress bar) |
| **B) Three-state** | Not Started / In Progress / Done (three-segment bar) |
| **C) Full phase breakdown** | Show each phase as a segment (New, In Dev, In Testing, Done) |
| **D) Three-state bar + hover detail** | B by default, hover/click shows C |

**Recommendation**: **D**. The three-segment bar is the sweet spot for at-a-glance understanding. Hover reveals full breakdown for users who care.

### Decision 5: Provider-specific vs. generic progress model

| Option | Approach |
|--------|----------|
| **A) Generic buckets** | All providers map to {notStarted, inProgress, done} — adapter normalizes |
| **B) Provider-specific rendering** | VE shows VE phases, GitHub shows GitHub states |
| **C) Generic + provider detail** | Generic summary, click to see provider-specific breakdown |

**Recommendation**: **A**. Keep the adapter contract generic. Each adapter maps its phases to `{ notStarted, inProgress, done }`. This is already roughly what we do.

---

## Proposed Data Model Changes

### Enhanced ChildProgress

```typescript
// Current
interface ChildProgress {
  total: number;
  completed: number;
  inProgress: number;
}

// Proposed
interface ChildProgress {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;      // NEW: explicit not-started count
  excluded: number;         // NEW: deferred/rejected/duplicate items
  items?: ChildItem[];      // NEW: optional item-level detail for drill-down
  depth: 'direct' | 'leaf'; // NEW: whether this counts children or grandchildren
}

interface ChildItem {
  entityId: string;
  entityType: string;
  title: string;
  phase: string;            // raw phase name from provider
  bucket: 'notStarted' | 'inProgress' | 'done' | 'excluded';
}
```

### Outcome-Level Progress (new)

```typescript
interface OutcomeProgress {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  excluded: number;
  linkBreakdown: Array<{
    linkId: string;
    entityType: string;
    entityId: string;
    title: string;
    progress: ChildProgress;
    overlapsWith?: string[];  // link IDs that share items with this link
  }>;
  computedAt: string;        // ISO timestamp
}
```

### New API Endpoint

```
GET /api/outcomes/:id/progress
```

Returns `OutcomeProgress`. Computed from cached link data + on-demand hierarchy traversal. Cached separately from individual link details.

---

## Deep Hierarchy Traversal

### Algorithm: VE

```
resolveProgress(entityType, entityId):
  if entityType === 'story':
    return { total: 1, [bucket(phase)]: 1 }  // leaf item

  children = fetchChildren(entityType, entityId)

  if entityType === 'epic':
    // Epic's children are features
    for each feature in children:
      stories = fetchChildren('feature', feature.id)
      if stories.length > 0:
        // Count stories (leaf level)
        aggregate(stories)
      else:
        // Feature has no stories yet — count the feature itself
        aggregate([feature])

  if entityType === 'feature':
    // Feature's children are stories
    aggregate(children)  // children ARE the leaf level
```

### API Call Budget

| Link Type | Calls (current) | Calls (proposed) |
|-----------|-----------------|------------------|
| Story | 0 | 0 |
| Feature | 1 (fetch stories) | 1 (same) |
| Epic | 1 (fetch features) | 1 + N (fetch features + fetch stories per feature) |

For an epic with 10 features, this is **11 API calls**. Mitigations:
- **Batch queries**: VE supports `parent EQ {id IN ["id1","id2",...]}` — fetch all stories for all features in one call
- **Aggressive caching**: Cache hierarchy for 30+ minutes (hierarchy changes slowly)
- **Background refresh**: Use the existing stale-link refresh cron to pre-compute progress
- **Limit depth**: Cap at 200 leaf items (already in current limit param)

### Algorithm: GitHub

```
resolveProgress(entityType, entityId):
  subIssues = fetchSubIssues(entityId)
  if subIssues.length === 0:
    return null  // no children
  // GitHub sub-issues are flat (no further nesting in practice)
  return aggregate(subIssues, state => state === 'closed' ? 'done' : 'inProgress')
```

GitHub is simpler: only one level of sub-issues, binary state.

---

## Overlap Detection Algorithm

When computing outcome-level progress across multiple links:

```
1. For each link, resolve its descendant item IDs (entityType + entityId pairs)
2. Build a Set of all item IDs across all links
3. For each pair of links, compute intersection of their item ID sets
4. If intersection is non-empty:
   a. Mark both links as having overlap
   b. For the aggregated outcome progress, count each item ONCE
   c. Use the link with the broader scope as the "owner" (epic > feature > story)
```

### When to run overlap detection

- **At link creation time**: When user connects a new item, check if its parent/children are already linked
- **At progress computation time**: Deduplicate in the rollup calculation
- **NOT eagerly for all items**: Only check overlap when we actually compute progress

---

## UI Design Sketches

### Outcome Card (list view) — Summary Bar

```
┌─────────────────────────────────────────────┐
│ O-012: FIPS 140-3 Compliance                │
│ Score: 850  │  Status: Active               │
│                                             │
│ Progress: ████████░░░░░░░░░░░ 12/28 (43%)  │
│           ▓▓▓▓▓▓▓▓████░░░░░░░              │
│           in-progress  done   not started   │
└─────────────────────────────────────────────┘
```

Three-segment bar:
- **Dark fill** (accent/blue): In Progress
- **Green fill**: Done  
- **Gray/empty**: Not Started

### Outcome Detail — Per-Link Breakdown

```
┌─────────────────────────────────────────────────┐
│ Linked Items                                     │
│                                                  │
│ Overall: 12/28 done, 8 in progress, 8 not started│
│ ▓▓▓▓▓▓▓▓▓▓████████████░░░░░░░░░░░░░░           │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │ ★ Epic 5113805: SDS Feature Parity          │ │
│ │   Phase: In Progress                         │ │
│ │   10/22 stories done, 6 in progress          │ │
│ │   ████████████████░░░░░░░░░░                 │ │
│ │                                              │ │
│ │   Features:                                  │ │
│ │   ✓ Repackage SimpleAPI (3/3 stories)        │ │
│ │   ◐ Native IPv6 Support (2/5 stories)        │ │
│ │   ○ Certificate Revocation (0/4 stories)     │ │
│ │   ○ Test Atalla Migration (no stories yet)   │ │
│ └──────────────────────────────────────────────┘ │
│                                                  │
│ ┌──────────────────────────────────────────────┐ │
│ │   Feature 4828389: UI Modernization          │ │
│ │   Phase: Done ✓                              │ │
│ │   ⚠ Overlap: included in Epic 5113805       │ │
│ │   2/2 stories done                           │ │
│ │   ████████████████████████████████           │ │
│ └──────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Hover/Expand — Phase Detail

```
┌──────────────────────────────┐
│ Phase Breakdown (22 stories) │
│                              │
│ Done         10  ████████    │
│ In Testing    3  ███         │
│ In Progress   3  ███         │
│ New           6  ██████      │
└──────────────────────────────┘
```

---

## Caching Strategy

### Two-Tier Cache

1. **Link-level cache** (existing): `cachedDetails.childProgress` on each external_link row
   - Refreshed via ETag every 15 minutes
   - Contains direct-child-only progress (current behavior)

2. **Outcome-level progress cache** (new): Separate table or JSONB column on outcomes
   - Computed from link-level caches + deep hierarchy data
   - Refreshed when any link's cache is updated
   - Stores the full `OutcomeProgress` structure

### Cache Invalidation

- When a link is refreshed → recompute outcome progress
- When a link is added/removed → recompute outcome progress
- Background cron: refresh all outcome progress every 30 minutes
- Manual refresh button on outcome detail

### Deep Hierarchy Cache

For epic-level links, the feature→story mapping changes slowly. Cache the hierarchy structure separately:

```typescript
// Could be a new table or extend cachedDetails
interface HierarchyCache {
  linkId: string;
  children: Array<{
    entityId: string;
    entityType: string;
    title: string;
    phase: string;
    childCount: number;
    childProgress: { total, completed, inProgress, notStarted };
  }>;
  fetchedAt: string;
}
```

---

## Implementation Phases

### Phase 1: Enhanced Phase Mapping (small, low-risk)
- [ ] Update VE adapter phase classification to use a proper mapping function
- [ ] Add `notStarted` to `ChildProgress` (currently only `total - completed - inProgress` implicitly)
- [ ] Handle unknown phases gracefully (default to inProgress, log warning)

### Phase 2: Deep Hierarchy for Epics (medium, core feature)
- [ ] Add `getDeepProgress(token, entityType, entityId)` to adapter interface
- [ ] Implement VE: epic → batch-fetch features → batch-fetch all stories
- [ ] Implement GitHub: same as current (sub-issues are already flat)
- [ ] Add hierarchy cache to `cachedDetails`
- [ ] Update refresh logic to call deep progress for epics

### Phase 3: Overlap Detection (medium, quality-of-life)
- [ ] At link-creation time: check if item's ancestors/descendants are already linked
- [ ] Show soft warning in ConnectDialog: "This feature is part of already-linked Epic X"
- [ ] At outcome progress computation: deduplicate items by entityId
- [ ] Store overlap annotations in outcome progress cache

### Phase 4: Outcome-Level Aggregation (medium, key UX)
- [ ] New endpoint: `GET /outcomes/:id/progress`
- [ ] Aggregate progress across all links, with dedup
- [ ] Update OutcomeDetail.vue: show summary bar above linked items
- [ ] Update outcome list cards: show mini progress bar

### Phase 5: Three-Segment Progress Bar UI (small, visual polish)
- [ ] New ProgressBar component: notStarted (gray) / inProgress (blue) / done (green)
- [ ] Hover tooltip with phase breakdown
- [ ] Use in ExternalLinkCard and OutcomeDetail
- [ ] Optional: expand to show per-feature breakdown for epic links

### Phase 6: Feature-Level Detail View (nice-to-have)
- [ ] Expandable section in epic link cards showing per-feature progress
- [ ] Status icons per feature: ✓ done, ◐ in progress, ○ not started
- [ ] Click-through to VE for individual features

---

## Open Questions

1. **Should stories without children count as "done" or "in progress"?** A feature with no stories might be in early planning. Currently we'd show the feature itself — should it count toward "not started"?

2. **How to handle VE items in "Deferred" state?** Deferred features shouldn't count against progress. Do we exclude them entirely or show them separately?

3. **Rate limiting**: VE API rate limits? If an outcome links to 5 epics with 10 features each, that's potentially 50+ API calls. Need to understand VE's tolerance.

4. **Should progress influence scoring?** If an outcome is 90% done, should that affect its priority score? (Probably not — scoring is about future value, not past work.)

5. **Real-time updates**: Should we use SSE to push progress updates when background refresh detects changes? Or is periodic polling sufficient?

6. **Phase query optimization**: VE's query language supports `phase EQ {id="phase.story.done"}` — can we count by phase server-side instead of fetching all items and filtering client-side?

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| VE API rate limiting on deep traversal | Medium | High — feature unusable | Batch queries, aggressive caching, limit depth |
| Custom phases not handled | Low | Medium — wrong progress counts | Default-to-inProgress fallback, phase discovery |
| Overlap detection false positives | Low | Low — cosmetic | Soft warnings only, never block |
| Large epics (100+ features) | Medium | Medium — slow computation | Pagination, limit=200, background computation |
| Stale cache shows wrong progress | Medium | Low — misleading but recoverable | Freshness indicator, manual refresh |
