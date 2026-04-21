---
status: future
priority: p3
issue_id: "017"
tags: [valueedge, github, sync, ux, editor]
---

# Backend-Aware Rich Description Editor

## Background
Different backend providers use different description formats:
- **OpenText ValueEdge** — HTML (e.g. `<p>Telemetry SDS</p>`)
- **GitHub** — Markdown

moou currently stores and edits descriptions as plain text. This creates two problems:
1. Pulling an HTML/Markdown description from a backend stores raw markup as literal text.
2. The user edits in the plain-text textarea → saves clean text → immediately out-of-sync
   with the backend's formatted version.

## Key Design Decision: Store Format on the Outcome

The description format **must** be stored on the outcome itself (not derived from the
current primary link) to prevent infinite sync cycles. Without this:

1. Pull `<p>Foo</p>` from VE → store as plain `Foo` (stripped)
2. moou `Foo` normalised = VE `<p>Foo</p>` normalised → ✓ in sync
3. User pushes → sends `Foo` to VE → VE stores `Foo` (no tags)
4. Next compare: VE `Foo` vs moou `Foo` → ✓ in sync (OK so far)
5. **But**: VE may re-wrap saved content as `<p>Foo</p>` on the next fetch
6. Now moou `Foo` ≠ VE `<p>Foo</p>` normalised-as-plain → false "out of sync" forever

The only stable solution: **store the description in the backend's native format**
and compare exactly — no normalisation needed, no round-trip mutation.

```
outcomes table: add `descriptionFormat TEXT DEFAULT 'plain'`
                        -- 'plain' | 'html' | 'markdown'
```

- On **pull**: store the raw value AND set `descriptionFormat` to the provider's format
- On **push**: send the stored value as-is (already in the correct format)
- On **compare**: exact string equality — no normalisation
- If the primary link is removed/changed: format stays on the outcome; editor continues
  to render it correctly until the user explicitly clears/reformats it

## Proposed Solution

### 1. Provider format declaration
Each adapter declares the format it uses for descriptions:

```ts
// adapter interface
descriptionFormat: 'plain' | 'html' | 'markdown';

// valueedge-adapter.ts
descriptionFormat = 'html' as const;   // VE uses HTML

// github-adapter.ts
descriptionFormat = 'markdown' as const;
```

### 2. Schema migration
```sql
ALTER TABLE outcomes ADD COLUMN description_format TEXT NOT NULL DEFAULT 'plain';
```

### 3. Pull handler update (`api/src/routes/outcomes.ts`)
```ts
// Store raw value + format
await db.update(outcomes).set({
  description: cached.description,
  descriptionFormat: adapter.descriptionFormat ?? 'plain',
}).where(eq(outcomes.id, outcomeId));
```

### 4. Format-aware editor in OutcomeForm
`OutcomeForm` receives `descriptionFormat` and renders the appropriate editor:

| Format | Editor |
|--------|--------|
| `plain` | Current `<textarea>` (unchanged) |
| `markdown` | `<textarea>` with preview toggle (`marked` or minimal renderer) |
| `html` | Lightweight rich-text editor (e.g. **Tiptap** or **Quill**) — bold, italic, lists, links |

### 5. Sync comparison
Exact string equality — no normalisation required since both sides are in the same format:
```ts
const descriptionOutOfSync = computed(() => {
  const remote = (primaryCache.value?.description as string) ?? '';
  const local = outcome.value?.description ?? '';
  return remote !== local;
});
```

### 6. Render remote value safely in sync preview
- `html` → sanitize with DOMPurify (allowlist: `b i em strong ul ol li p br a span`) then `v-html`
- `markdown` → `marked` + sanitize then `v-html`
- `plain` → `{{ value }}`

## Effort
Medium (~1 day).
- One migration (add `description_format` column).
- Tiptap or Quill adds ~50–100 kB to the bundle; evaluate at implementation time.
- DOMPurify (~7 kB) for safe HTML rendering in the preview.
- `marked` (~20 kB) for Markdown rendering.

## Open Question
- Should push to GitHub auto-convert stored HTML to Markdown if the user previously
  had a VE primary link and switches to GitHub?
