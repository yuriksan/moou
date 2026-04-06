import { describe, it, expect } from 'vitest';
import { checkMismatch, checkOutcomeMismatches, mismatchSummary } from '../composables/useDateMismatch';

describe('checkMismatch', () => {
  it('returns null when motivation has no date', () => {
    const result = checkMismatch(
      { title: 'Tech debt', attributes: { incident_frequency: 5 } },
      '2026-09-30',
    );
    expect(result).toBeNull();
  });

  it('returns null when motivation date is after milestone', () => {
    const result = checkMismatch(
      { title: 'Customer need', attributes: { target_date: '2026-12-01' } },
      '2026-09-30',
    );
    expect(result).toBeNull();
  });

  it('returns warning when motivation date is 1-89 days before milestone', () => {
    const result = checkMismatch(
      { title: 'Acme Corp', attributes: { target_date: '2026-09-01' } },
      '2026-09-30',
    );
    expect(result).not.toBeNull();
    expect(result!.level).toBe('warning');
    expect(result!.daysBefore).toBe(29);
  });

  it('returns critical when motivation date is >90 days before milestone', () => {
    const result = checkMismatch(
      { title: 'Urgent customer', attributes: { target_date: '2026-04-01' } },
      '2026-09-30',
    );
    expect(result).not.toBeNull();
    expect(result!.level).toBe('critical');
    expect(result!.daysBefore).toBeGreaterThan(90);
  });

  it('detects mandate_deadline too', () => {
    const result = checkMismatch(
      { title: 'GDPR mandate', attributes: { mandate_deadline: '2026-05-01' } },
      '2026-09-30',
    );
    expect(result).not.toBeNull();
    expect(result!.level).toBe('critical');
  });

  it('returns null when dates are equal', () => {
    const result = checkMismatch(
      { title: 'Same day', attributes: { target_date: '2026-09-30' } },
      '2026-09-30',
    );
    expect(result).toBeNull();
  });
});

describe('checkOutcomeMismatches', () => {
  it('returns empty array when no milestone date', () => {
    const result = checkOutcomeMismatches(
      [{ title: 'M1', attributes: { target_date: '2026-04-01' } }],
      null,
    );
    expect(result).toEqual([]);
  });

  it('returns mismatches sorted by severity', () => {
    const result = checkOutcomeMismatches(
      [
        { title: 'Warning', attributes: { target_date: '2026-09-01' } },
        { title: 'Critical', attributes: { target_date: '2026-04-01' } },
        { title: 'OK', attributes: { target_date: '2026-12-01' } },
      ],
      '2026-09-30',
    );
    expect(result).toHaveLength(2); // OK is excluded
    expect(result[0]!.level).toBe('critical');
    expect(result[1]!.level).toBe('warning');
  });
});

describe('mismatchSummary', () => {
  it('counts critical and warning', () => {
    const mismatches = [
      { level: 'critical' as const, motivationTitle: 'A', motivationDate: '', milestoneDate: '', daysBefore: 100, message: '' },
      { level: 'critical' as const, motivationTitle: 'B', motivationDate: '', milestoneDate: '', daysBefore: 120, message: '' },
      { level: 'warning' as const, motivationTitle: 'C', motivationDate: '', milestoneDate: '', daysBefore: 30, message: '' },
    ];
    const summary = mismatchSummary(mismatches);
    expect(summary.critical).toBe(2);
    expect(summary.warning).toBe(1);
  });

  it('returns zeros for empty array', () => {
    expect(mismatchSummary([])).toEqual({ critical: 0, warning: 0 });
  });
});
