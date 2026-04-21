---
status: future
priority: p3
issue_id: "017"
tags: [valueedge, sync, ux]
---

# VE HTML Descriptions: Strip on Pull, Render Sanitized in Preview

## Background
ValueEdge descriptions often contain HTML (e.g. `<p>Telemetry SDS</p>`). moou stores
descriptions as plain text. Without handling this:
- Pulling a VE description stores raw HTML tags as literal text in moou.
- The user then edits the plain-text form and saves `Telemetry SDS` — which immediately
  appears out-of-sync with VE's `<p>Telemetry SDS</p>`.
- The sync preview shows HTML markup as raw text, which is confusing.

## Proposed Solution

### 1. Strip HTML on pull (backend, `api/src/routes/outcomes.ts` pull-primary handler)
When pulling `description` from cached details, convert HTML to plain text before storing:
```ts
function htmlToPlainText(html: string): string {
  // Simple tag-strip; safe since this runs server-side, not in the browser
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
```

### 2. Normalise for comparison (frontend, `descriptionOutOfSync` computed)
Strip tags from the remote value before comparing so that `<p>Foo</p>` vs `Foo` is
considered **in sync**:
```ts
const descriptionOutOfSync = computed(() => {
  const remote = stripTags((primaryCache.value?.description as string) ?? '');
  const local = outcome.value?.description ?? '';
  return remote !== local;
});
```
`stripTags` can use `DOMParser` (no extra dependency):
```ts
function stripTags(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent?.trim() ?? '';
}
```

### 3. Render remote HTML safely in sync preview (frontend)
In the sync preview panel's remote description cell, use `v-html` with DOMPurify
(allowlist: `b i em strong ul ol li p br a`, no `on*` attributes, no `script`/`style`/`iframe`):
```ts
import DOMPurify from 'dompurify';
const ALLOWED_TAGS = ['b','i','em','strong','ul','ol','li','p','br','a','span'];
const ALLOWED_ATTR = ['href','target'];
function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
```
```html
<div class="sync-value-text" v-html="safeHtml(primaryCache?.description as string)"></div>
```

## Effort
Small — ~1h. No schema changes. DOMPurify is the only new dependency (~7 kB gzipped).

## Notes
- The local (moou) description is always plain text so no sanitization needed there.
- `DOMParser` is browser-only; the strip-on-pull logic on the backend uses a regex strip
  instead (safe since it's not rendered, just stored as text).
