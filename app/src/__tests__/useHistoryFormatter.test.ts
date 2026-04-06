import { describe, it, expect } from 'vitest';
import {
  formatHistoryEntry,
  formatHistory,
  type HistoryEntry,
} from '../composables/useHistoryFormatter';

function entry(changeType: string, changes: Record<string, { old: unknown; new: unknown }> = {}): HistoryEntry {
  return { id: 'h-1', changeType, changes, changedBy: 'sarah', changedAt: '2026-04-06T18:00:00Z' };
}

describe('formatHistoryEntry', () => {
  describe('non-update change types', () => {
    it('formats created', () => {
      expect(formatHistoryEntry(entry('created'))).toBe('created');
    });

    it('formats deleted with the old title when available', () => {
      expect(formatHistoryEntry(entry('deleted', { title: { old: 'Old name', new: null } })))
        .toBe('deleted (was "Old name")');
    });

    it('falls back to plain "deleted" when no title is in changes', () => {
      expect(formatHistoryEntry(entry('deleted'))).toBe('deleted');
    });

    it('formats pinned/unpinned/resolved/reopened with bare verbs', () => {
      expect(formatHistoryEntry(entry('pinned'))).toBe('pinned');
      expect(formatHistoryEntry(entry('unpinned'))).toBe('unpinned');
      expect(formatHistoryEntry(entry('resolved'))).toBe('resolved');
      expect(formatHistoryEntry(entry('reopened'))).toBe('reopened');
    });

    it('formats linked motivation with title when context provides it', () => {
      const e = entry('linked', { motivation_id: { old: null, new: 'm-1' } });
      expect(formatHistoryEntry(e, { motivationTitles: { 'm-1': 'Acme renewal' } }))
        .toBe('linked motivation "Acme renewal"');
    });

    it('falls back to "linked motivation" without context', () => {
      const e = entry('linked', { motivation_id: { old: null, new: 'm-1' } });
      expect(formatHistoryEntry(e)).toBe('linked motivation');
    });

    it('formats unlinked motivation', () => {
      const e = entry('unlinked', { motivation_id: { old: 'm-1', new: null } });
      expect(formatHistoryEntry(e, { motivationTitles: { 'm-1': 'Acme renewal' } }))
        .toBe('unlinked motivation "Acme renewal"');
    });
  });

  describe('updated entries', () => {
    it('returns null when only auto-computed fields changed (pure noise)', () => {
      const e = entry('updated', {
        updatedAt: { old: '2026-01-01', new: '2026-04-06' },
        priorityScore: { old: '100', new: '120' },
      });
      expect(formatHistoryEntry(e)).toBeNull();
    });

    it('returns null for an empty changes blob', () => {
      expect(formatHistoryEntry(entry('updated', {}))).toBeNull();
    });

    it('formats milestone reassignment with the milestone name when available', () => {
      const e = entry('updated', {
        updatedAt: { old: 'a', new: 'b' },  // noise — should be filtered
        milestoneId: { old: 'ms-q2', new: 'ms-q3' },
      });
      expect(formatHistoryEntry(e, { milestoneNames: { 'ms-q2': 'Q2 Release', 'ms-q3': 'Q3 Release' } }))
        .toBe('moved to Q3 Release');
    });

    it('formats milestone clear as "moved to backlog"', () => {
      const e = entry('updated', { milestoneId: { old: 'ms-q2', new: null } });
      expect(formatHistoryEntry(e, { milestoneNames: { 'ms-q2': 'Q2 Release' } }))
        .toBe('moved to backlog');
    });

    it('falls back to "a milestone" when the new id is unknown', () => {
      const e = entry('updated', { milestoneId: { old: null, new: 'ms-unknown' } });
      expect(formatHistoryEntry(e)).toBe('moved to a milestone');
    });

    it('says "edited title" rather than dumping the old + new strings', () => {
      const e = entry('updated', { title: { old: 'Old', new: 'New' } });
      expect(formatHistoryEntry(e)).toBe('edited title');
    });

    it('says "edited description"', () => {
      const e = entry('updated', { description: { old: 'a', new: 'b' } });
      expect(formatHistoryEntry(e)).toBe('edited description');
    });

    it('shows effort transitions inline', () => {
      const e = entry('updated', { effort: { old: 'M', new: 'L' } });
      expect(formatHistoryEntry(e)).toBe('effort: "M" → "L"');
    });

    it('shows status transitions inline', () => {
      const e = entry('updated', { status: { old: 'active', new: 'completed' } });
      expect(formatHistoryEntry(e)).toBe('status: "active" → "completed"');
    });

    it('says "set X" when going from null to a value', () => {
      const e = entry('updated', { effort: { old: null, new: 'L' } });
      expect(formatHistoryEntry(e)).toBe('set effort to "L"');
    });

    it('says "removed X" when going from a value to null', () => {
      const e = entry('updated', { effort: { old: 'L', new: null } });
      expect(formatHistoryEntry(e)).toBe('removed effort');
    });

    it('humanizes nested attribute keys (attributes.revenue_at_risk → "revenue at risk")', () => {
      const e = entry('updated', {
        'attributes.revenue_at_risk': { old: 100000, new: 200000 },
      });
      expect(formatHistoryEntry(e)).toBe('revenue at risk: 100000 → 200000');
    });

    it('combines two field changes with "and"', () => {
      const e = entry('updated', {
        title: { old: 'A', new: 'B' },
        effort: { old: 'M', new: 'L' },
      });
      expect(formatHistoryEntry(e)).toBe('edited title and effort: "M" → "L"');
    });

    it('combines three+ field changes with commas and an Oxford "and"', () => {
      const e = entry('updated', {
        title: { old: 'A', new: 'B' },
        effort: { old: 'M', new: 'L' },
        status: { old: 'draft', new: 'active' },
      });
      expect(formatHistoryEntry(e))
        .toBe('edited title, effort: "M" → "L", and status: "draft" → "active"');
    });

    it('drops noise fields when combined with meaningful ones', () => {
      const e = entry('updated', {
        updatedAt: { old: 'a', new: 'b' },  // dropped
        priorityScore: { old: '100', new: '120' },  // dropped
        effort: { old: 'M', new: 'L' },  // kept
      });
      expect(formatHistoryEntry(e)).toBe('effort: "M" → "L"');
    });

    it('truncates long string values when showing them inline', () => {
      const longString = 'this is a very long string that should be truncated for display';
      const e = entry('updated', { name: { old: 'short', new: longString } });
      expect(formatHistoryEntry(e)).toContain('…');
      expect(formatHistoryEntry(e)!.length).toBeLessThan(60);
    });
  });
});

describe('formatHistory (batch)', () => {
  it('drops noise-only entries from the result', () => {
    const entries = [
      entry('updated', { title: { old: 'A', new: 'B' } }),
      entry('updated', { updatedAt: { old: 'a', new: 'b' } }),  // noise → dropped
      entry('created'),
    ];
    const result = formatHistory(entries);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('edited title');
    expect(result[1]!.text).toBe('created');
  });

  it('preserves the original entry alongside the formatted text', () => {
    const e = entry('pinned');
    const [row] = formatHistory([e]);
    expect(row!.entry).toBe(e);
    expect(row!.text).toBe('pinned');
  });

  it('returns an empty array when everything is noise', () => {
    const noisy = [
      entry('updated', { updatedAt: { old: 'a', new: 'b' } }),
      entry('updated', { priorityScore: { old: '100', new: '120' } }),
    ];
    expect(formatHistory(noisy)).toEqual([]);
  });
});
