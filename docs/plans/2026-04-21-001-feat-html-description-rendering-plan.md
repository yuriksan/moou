---
title: "feat: Backend-aware rich description rendering and editing"
type: feat
status: active
date: 2026-04-21
origin: todos/017-future-ve-html-description-rendering.md
---

# Backend-Aware Rich Description Rendering & Editing

## Overview

Store the description format (`plain`, `html`, `markdown`) on each outcome so moou can render and edit descriptions in their native format. ValueEdge sends HTML, GitHub sends Markdown — today both are stored and displayed as plain text, breaking sync round-trips and losing formatting.

## Why This Approach

(see origin: `todos/017-future-ve-html-description-rendering.md`)

Storing format on the outcome (not deriving from the current primary link) prevents infinite sync cycles. The format persists even if the primary link changes. Exact string comparison replaces lossy normalization.

## Key Decisions

- **Display (read-only):** `v-html` + DOMPurify — preserves whitespace exactly, no round-trip through a document model, 9KB gzipped
- **Editing:** Tiptap WYSIWYG for `html` format — ProseMirror round-trip normalization is acceptable since the user is intentionally editing. Whitespace changes on edit are fine; whitespace changes on **view-only** are not.
- **Markdown:** textarea with no renderer for now (already works). Can add a preview toggle later.
- **Plain:** current textarea unchanged

## Acceptance Criteria

### Functional
- [ ] New `description_format` column on outcomes (`'plain' | 'html' | 'markdown'`, default `'plain'`)
- [ ] Pull from ValueEdge sets `descriptionFormat: 'html'` and stores raw HTML
- [ ] Pull from GitHub sets `descriptionFormat: 'markdown'` and stores raw Markdown
- [ ] OutcomeDetail renders HTML descriptions via `v-html` + DOMPurify (read-only mode)
- [ ] OutcomeDetail renders Markdown descriptions as plain text (same as today, textarea)
- [ ] Clicking to edit an HTML description opens Tiptap WYSIWYG editor
- [ ] Saving from Tiptap stores the HTML output back to `description`
- [ ] Sync panel renders remote HTML/Markdown safely (sanitized `v-html` for HTML, plain text for others)
- [ ] Push sends stored description as-is (already in backend's native format)
- [ ] Sync comparison uses exact string equality (no normalization)

### Whitespace
- [ ] Viewing an HTML description does NOT alter the stored value
- [ ] `<pre>` blocks with indentation render correctly
- [ ] Multiple `<br>` tags in sequence render as multiple line breaks
- [ ] `&nbsp;` entities render as non-breaking spaces
- [ ] Inline `style="white-space: pre"` on spans is preserved by DOMPurify and rendered
- [ ] Leading/trailing whitespace in paragraphs is preserved in display

### Testing
- [ ] API test: pull sets descriptionFormat correctly
- [ ] API test: GET /outcomes/:id returns descriptionFormat field
- [ ] API test: push sends description as-is regardless of format
- [ ] Frontend: HTML description renders formatted (manual QA)
- [ ] Frontend: editing HTML description in Tiptap and saving round-trips correctly (manual QA)
- [ ] Frontend: viewing then navigating away does NOT trigger a save/mutation

## Technical Approach

### Phase 1: Schema + API

**File: `api/src/db/schema.ts`**

Add column to outcomes table:
```typescript
descriptionFormat: text('description_format').notNull().default('plain'),
```

**New migration** (`api/drizzle/0003_*.sql`):
```sql
ALTER TABLE outcomes ADD COLUMN description_format TEXT NOT NULL DEFAULT 'plain';
```

**File: `api/src/providers/adapter.ts`**

Add to BackendAdapter interface:
```typescript
descriptionFormat: 'plain' | 'html' | 'markdown';
```

**File: `api/src/providers/valueedge-adapter.ts`**
- Add `descriptionFormat = 'html' as const` property

**File: `api/src/providers/github-adapter.ts`**
- Add `descriptionFormat = 'markdown' as const` property

**File: `api/src/routes/backend.ts`**

Update pull handler (`POST /outcomes/:id/pull-primary`, ~line 501):
- When pulling description, also set `descriptionFormat` to `adapter.descriptionFormat`
- When pulling from a link for the first time (connect/publish), set format

Publish handler (`POST /outcomes/:id/publish`):
- Does NOT change `descriptionFormat` — the outcome's existing description is plain text that gets sent as-is. Format only changes when content is pulled FROM the backend.

**File: `api/src/routes/outcomes.ts`**

Ensure `GET /outcomes` and `GET /outcomes/:id` return `descriptionFormat` in responses.

### Phase 2: Frontend Display (Read-Only)

**Install dependency:**
```bash
npm install dompurify --workspace=app
npm install -D @types/dompurify --workspace=app
```

**New file: `app/src/composables/useSanitizedHtml.ts`**
```typescript
import DOMPurify from 'dompurify';

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'em', 'strong', 'ul', 'ol', 'li',
                 'a', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
                 'pre', 'div', 'h1', 'h2', 'h3', 'h4', 'sub', 'sup', 'hr', 'blockquote'],
  ALLOWED_ATTR: ['href', 'target', 'style', 'class'],
  FORCE_BODY: true,
};

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}
```

**File: `app/src/components/OutcomeDetail.vue`**

Replace the description display section (~line 463-469):

```html
<!-- Current: plain text -->
<div class="description">{{ outcome.description }}</div>

<!-- New: format-aware -->
<div v-if="outcome.descriptionFormat === 'html'"
     class="description description-html"
     v-html="sanitizedDescription" />
<div v-else class="description">{{ outcome.description }}</div>
```

Add computed:
```typescript
const sanitizedDescription = computed(() =>
  outcome.value?.description ? sanitizeHtml(outcome.value.description) : ''
);
```

CSS additions:
```css
.description-html pre { white-space: pre-wrap; word-break: break-word; }
.description-html p { margin: 0.4em 0; }
.description-html ul, .description-html ol { margin: 0.4em 0; padding-left: 1.5em; }
.description-html table { border-collapse: collapse; }
.description-html td, .description-html th { border: 1px solid var(--border); padding: 4px 8px; }
```

**Sync panel** (~lines 428-445): Same treatment — render remote description with `v-html` when format is `html`, plain text otherwise.

### Phase 3: Frontend Editing (Tiptap)

**Install dependencies:**
```bash
npm install @tiptap/vue-3 @tiptap/starter-kit @tiptap/extension-link --workspace=app
```

Bundle impact: ~80-100KB gzipped (acceptable for an ALM tool).

**File: `app/src/components/OutcomeForm.vue`**

When `descriptionFormat === 'html'`, replace the textarea with a Tiptap editor:

```typescript
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

// Only create editor when format is html
const editor = props.descriptionFormat === 'html'
  ? useEditor({
      content: props.description || '',
      extensions: [StarterKit, Link.configure({ openOnClick: false })],
    })
  : null;
```

Template:
```html
<template v-if="descriptionFormat === 'html'">
  <div class="tiptap-toolbar">
    <button @click="editor.chain().focus().toggleBold().run()" :class="{ active: editor?.isActive('bold') }">B</button>
    <button @click="editor.chain().focus().toggleItalic().run()" :class="{ active: editor?.isActive('italic') }">I</button>
    <button @click="editor.chain().focus().toggleBulletList().run()">• List</button>
    <button @click="editor.chain().focus().toggleOrderedList().run()">1. List</button>
  </div>
  <EditorContent :editor="editor" class="tiptap-editor" />
</template>
<textarea v-else v-model="form.description" ... />
```

On save, extract HTML:
```typescript
const description = editor ? editor.getHTML() : form.value.description.trim() || null;
```

### Phase 4: Adapter Format on Pull/Push

No changes needed to push logic — description is already sent as-is via `adapter.updateItem({ description })`.

Pull logic update in `api/src/routes/backend.ts`:
- `pullField('description')` handler (~line 501) must also update `descriptionFormat` when pulling description for the first time from a newly connected link.

## Open Questions

- **Cross-provider format conversion**: If an outcome has an HTML description from VE and the user switches the primary link to GitHub, should we auto-convert HTML→Markdown on push? **Recommendation: defer.** Show a warning in the sync panel instead ("Format mismatch: moou stores HTML but GitHub expects Markdown"). This avoids lossy auto-conversion and keeps the scope small.

## Dependencies

| Package | Size (gzip) | Purpose |
|---------|-------------|---------|
| `dompurify` | ~9 KB | HTML sanitization for safe v-html |
| `@types/dompurify` | dev only | TypeScript types |
| `@tiptap/vue-3` | ~80-100 KB total | WYSIWYG HTML editor |
| `@tiptap/starter-kit` | (included above) | Bold, italic, lists, headings, etc. |
| `@tiptap/extension-link` | (included above) | Link editing support |

## Sources & References

- Origin: [todos/017-future-ve-html-description-rendering.md](../../todos/017-future-ve-html-description-rendering.md)
- Outcomes schema: `api/src/db/schema.ts:109-124`
- OutcomeDetail display: `app/src/components/OutcomeDetail.vue:463-469`
- OutcomeForm textarea: `app/src/components/OutcomeForm.vue:95-98`
- Sync panel: `app/src/components/OutcomeDetail.vue:402-450`
- Pull handler: `api/src/routes/backend.ts` POST `/outcomes/:id/pull-primary`
- Push handler: `api/src/routes/backend.ts` POST `/outcomes/:id/push-primary`
- Adapter interface: `api/src/providers/adapter.ts`
- DOMPurify FORCE_BODY for whitespace: https://github.com/cure53/DOMPurify/issues/299
