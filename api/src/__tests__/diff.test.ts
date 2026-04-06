import { describe, it, expect } from 'vitest';
import { flatDiff, createDiff } from '../lib/diff.js';

describe('flatDiff', () => {
  it('detects changed fields', () => {
    const result = flatDiff(
      { title: 'old', status: 'draft' },
      { title: 'new', status: 'draft' },
    );
    expect(result).toEqual({
      title: { old: 'old', new: 'new' },
    });
  });

  it('detects added fields', () => {
    const result = flatDiff(
      { title: 'test' },
      { title: 'test', description: 'added' },
    );
    expect(result).toEqual({
      description: { old: null, new: 'added' },
    });
  });

  it('detects removed fields', () => {
    const result = flatDiff(
      { title: 'test', description: 'will be removed' },
      { title: 'test' },
    );
    expect(result).toEqual({
      description: { old: 'will be removed', new: null },
    });
  });

  it('produces dotted keys for nested changes', () => {
    const result = flatDiff(
      { attributes: { revenue_at_risk: 100000, segment: 'enterprise' } },
      { attributes: { revenue_at_risk: 200000, segment: 'enterprise' } },
    );
    expect(result).toEqual({
      'attributes.revenue_at_risk': { old: 100000, new: 200000 },
    });
  });

  it('returns empty object for identical inputs', () => {
    const obj = { title: 'same', status: 'active' };
    expect(flatDiff(obj, { ...obj })).toEqual({});
  });

  it('handles null values', () => {
    const result = flatDiff(
      { effort: null },
      { effort: 'M' },
    );
    expect(result).toEqual({
      effort: { old: null, new: 'M' },
    });
  });
});

describe('createDiff', () => {
  it('produces null→value diffs for all fields', () => {
    const result = createDiff({ title: 'New Outcome', status: 'draft' });
    expect(result).toEqual({
      title: { old: null, new: 'New Outcome' },
      status: { old: null, new: 'draft' },
    });
  });

  it('handles nested objects as whole values on create', () => {
    const result = createDiff({ attributes: { confidence: 0.9 } });
    // On create (diff from {}), the whole object is a single CREATE
    expect(result).toEqual({
      attributes: { old: null, new: { confidence: 0.9 } },
    });
  });
});
