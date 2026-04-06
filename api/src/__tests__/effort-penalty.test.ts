import { describe, it, expect } from 'vitest';
import { EFFORT_PENALTY, type EffortSize } from '../types.js';

describe('EFFORT_PENALTY', () => {
  it('maps all t-shirt sizes', () => {
    expect(EFFORT_PENALTY.XS).toBe(0);
    expect(EFFORT_PENALTY.S).toBe(50);
    expect(EFFORT_PENALTY.M).toBe(150);
    expect(EFFORT_PENALTY.L).toBe(300);
    expect(EFFORT_PENALTY.XL).toBe(500);
  });

  it('has entries for all EffortSize values', () => {
    const sizes: EffortSize[] = ['XS', 'S', 'M', 'L', 'XL'];
    for (const size of sizes) {
      expect(EFFORT_PENALTY[size]).toBeTypeOf('number');
    }
  });

  it('increases monotonically', () => {
    const sizes: EffortSize[] = ['XS', 'S', 'M', 'L', 'XL'];
    for (let i = 1; i < sizes.length; i++) {
      expect(EFFORT_PENALTY[sizes[i]!]).toBeGreaterThan(EFFORT_PENALTY[sizes[i - 1]!]);
    }
  });
});
