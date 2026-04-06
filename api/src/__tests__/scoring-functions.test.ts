import { describe, it, expect } from 'vitest';
import {
  date_urgency,
  severity_weight,
  strategic_weight,
  override_weight,
  blast_radius_weight,
  gap_weight,
  k,
} from '../scoring/functions.js';

describe('date_urgency', () => {
  function daysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0]!;
  }

  it('returns 1.2 for overdue dates', () => {
    expect(date_urgency(daysFromNow(-5))).toBe(1.2);
  });

  it('returns 1.0 for dates less than 7 days away', () => {
    expect(date_urgency(daysFromNow(3))).toBe(1.0);
  });

  it('returns 0.8 for dates 7-30 days away', () => {
    expect(date_urgency(daysFromNow(15))).toBe(0.8);
  });

  it('returns 0.5 for dates 30-90 days away', () => {
    expect(date_urgency(daysFromNow(60))).toBe(0.5);
  });

  it('returns 0.2 for dates over 90 days away', () => {
    expect(date_urgency(daysFromNow(120))).toBe(0.2);
  });

  it('returns 0 for null/undefined/invalid', () => {
    expect(date_urgency(null)).toBe(0);
    expect(date_urgency(undefined)).toBe(0);
    expect(date_urgency('not-a-date')).toBe(0);
    expect(date_urgency('')).toBe(0);
  });
});

describe('severity_weight', () => {
  it('maps known levels', () => {
    expect(severity_weight('critical')).toBe(1.0);
    expect(severity_weight('high')).toBe(0.7);
    expect(severity_weight('medium')).toBe(0.4);
    expect(severity_weight('low')).toBe(0.1);
  });

  it('returns 0 for unknown values', () => {
    expect(severity_weight('unknown')).toBe(0);
    expect(severity_weight(null)).toBe(0);
    expect(severity_weight(undefined)).toBe(0);
  });
});

describe('strategic_weight', () => {
  it('returns 1.5 for truthy', () => {
    expect(strategic_weight(true)).toBe(1.5);
    expect(strategic_weight(1)).toBe(1.5);
  });

  it('returns 1.0 for falsy', () => {
    expect(strategic_weight(false)).toBe(1.0);
    expect(strategic_weight(0)).toBe(1.0);
    expect(strategic_weight(null)).toBe(1.0);
    expect(strategic_weight(undefined)).toBe(1.0);
  });
});

describe('override_weight', () => {
  it('uses same mapping as severity_weight', () => {
    expect(override_weight('critical')).toBe(1.0);
    expect(override_weight('low')).toBe(0.1);
  });
});

describe('blast_radius_weight', () => {
  it('maps known levels', () => {
    expect(blast_radius_weight('platform-wide')).toBe(1.0);
    expect(blast_radius_weight('service')).toBe(0.6);
    expect(blast_radius_weight('component')).toBe(0.3);
  });

  it('returns 0 for unknown', () => {
    expect(blast_radius_weight('unknown')).toBe(0);
  });
});

describe('gap_weight', () => {
  it('maps known levels', () => {
    expect(gap_weight('table-stakes')).toBe(1.0);
    expect(gap_weight('differentiator')).toBe(0.6);
    expect(gap_weight('nice-to-have')).toBe(0.2);
  });

  it('returns 0 for unknown', () => {
    expect(gap_weight('other')).toBe(0);
  });
});

describe('k (currency scale)', () => {
  it('divides by 1000', () => {
    expect(k(1800000)).toBe(1800);
    expect(k(500000)).toBe(500);
    expect(k(5000000)).toBe(5000);
  });

  it('handles small values', () => {
    expect(k(1000)).toBe(1);
    expect(k(500)).toBe(0.5);
  });

  it('returns 0 for null/undefined/NaN', () => {
    expect(k(null)).toBe(0);
    expect(k(undefined)).toBe(0);
    expect(k('not a number')).toBe(0);
  });

  it('handles zero', () => {
    expect(k(0)).toBe(0);
  });
});
