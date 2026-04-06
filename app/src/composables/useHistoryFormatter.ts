/**
 * Format a history entry into a short human-readable phrase.
 *
 * The history table stores rich field-level diffs but the UI was rendering
 * only "updated" / "created" — completely opaque about what actually changed.
 * This composable turns those diffs into a single short verb phrase like
 * "moved to Q3 Release" or "effort: M → L" or "edited title and description".
 *
 * Returns null for entries that are pure noise (e.g. an `updated` row whose
 * only change is the auto-incrementing `updatedAt` timestamp). Callers should
 * filter null entries out of the rendered list.
 */

export interface HistoryChange {
  old: unknown;
  new: unknown;
}

export interface HistoryEntry {
  id?: string;
  changeType: string;
  changes: Record<string, HistoryChange>;
  changedAt?: string;
  changedBy?: string;
}

export interface FormatterContext {
  /** Map of milestone id → display name. Used to resolve `milestoneId` changes. */
  milestoneNames?: Record<string, string>;
  /** Map of motivation id → display title. Used for linked/unlinked. */
  motivationTitles?: Record<string, string>;
}

// Fields whose values are auto-computed by the server and would only add noise.
const NOISE_FIELDS = new Set(['updatedAt', 'priorityScore', 'score', 'createdAt']);

// Pretty labels for known field names. Anything not in here uses the raw key.
const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  effort: 'effort',
  status: 'status',
  type: 'type',
  pinned: 'pinned',
  notes: 'notes',
  emoji: 'emoji',
  colour: 'colour',
  name: 'name',
  targetDate: 'target date',
};

function humanizeKey(key: string): string {
  // attributes.revenue_at_risk → "revenue at risk"
  const last = key.split('.').pop() ?? key;
  return last.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function fieldLabel(key: string): string {
  if (key.startsWith('attributes.')) return humanizeKey(key);
  return FIELD_LABELS[key] ?? humanizeKey(key);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(none)';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    // Truncate long strings (descriptions etc.) so the phrase stays short.
    return v.length > 30 ? `"${v.slice(0, 30)}…"` : `"${v}"`;
  }
  return String(v);
}

function describeChange(key: string, change: HistoryChange, ctx: FormatterContext): string | null {
  // Special-case milestone reassignment — use the milestone name when we can.
  if (key === 'milestoneId') {
    const lookup = ctx.milestoneNames ?? {};
    const target = change.new == null ? 'backlog' : (lookup[change.new as string] ?? 'a milestone');
    return `moved to ${target}`;
  }

  // Long free-text fields don't fit on one line — just say they were edited.
  if (key === 'title' || key === 'description' || key === 'notes') {
    return `edited ${fieldLabel(key)}`;
  }

  // Booleans flip cleanly: "set pinned" / "unset pinned" feels wrong;
  // the dedicated changeTypes 'pinned'/'unpinned' should handle this case
  // for outcomes, but we keep a fallback.
  if (typeof change.new === 'boolean' || typeof change.old === 'boolean') {
    return change.new
      ? `set ${fieldLabel(key)}`
      : `unset ${fieldLabel(key)}`;
  }

  // Short categorical fields look best as "old → new".
  if (change.old !== null && change.old !== undefined && change.new !== null && change.new !== undefined) {
    return `${fieldLabel(key)}: ${formatValue(change.old)} → ${formatValue(change.new)}`;
  }
  if (change.new === null || change.new === undefined) {
    return `removed ${fieldLabel(key)}`;
  }
  return `set ${fieldLabel(key)} to ${formatValue(change.new)}`;
}

function formatUpdate(changes: Record<string, HistoryChange>, ctx: FormatterContext): string | null {
  const meaningful = Object.entries(changes).filter(([k]) => !NOISE_FIELDS.has(k));
  if (meaningful.length === 0) return null;

  const phrases = meaningful
    .map(([k, c]) => describeChange(k, c, ctx))
    .filter((p): p is string => p !== null);

  if (phrases.length === 0) return null;
  if (phrases.length === 1) return phrases[0]!;
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases.at(-1)}`;
}

/**
 * Turn a single history entry into a short verb phrase, or null if the entry
 * carries no information worth showing the user.
 */
export function formatHistoryEntry(entry: HistoryEntry, ctx: FormatterContext = {}): string | null {
  const t = entry.changeType;
  const changes = entry.changes ?? {};

  switch (t) {
    case 'created':
      return 'created';
    case 'deleted': {
      const title = changes.title?.old ?? changes.name?.old;
      return typeof title === 'string' ? `deleted (was "${title}")` : 'deleted';
    }
    case 'pinned':
      return 'pinned';
    case 'unpinned':
      return 'unpinned';
    case 'resolved':
      return 'resolved';
    case 'reopened':
      return 'reopened';
    case 'linked': {
      const motId = changes.motivation_id?.new as string | undefined;
      const title = motId ? ctx.motivationTitles?.[motId] : undefined;
      return title ? `linked motivation "${title}"` : 'linked motivation';
    }
    case 'unlinked': {
      const motId = changes.motivation_id?.old as string | undefined;
      const title = motId ? ctx.motivationTitles?.[motId] : undefined;
      return title ? `unlinked motivation "${title}"` : 'unlinked motivation';
    }
    case 'updated':
      return formatUpdate(changes, ctx);
    default:
      return t; // unknown change type — fall back to raw value
  }
}

/**
 * Format an array of history entries, dropping noise-only ones. Returns the
 * original entry alongside its formatted text so the caller can render
 * timestamps, authors, etc.
 */
export function formatHistory<T extends HistoryEntry>(
  entries: T[],
  ctx: FormatterContext = {},
): Array<{ entry: T; text: string }> {
  return entries
    .map(entry => ({ entry, text: formatHistoryEntry(entry, ctx) }))
    .filter((row): row is { entry: T; text: string } => row.text !== null);
}
