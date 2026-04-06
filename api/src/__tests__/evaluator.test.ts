import { describe, it, expect } from 'vitest';
import { evaluateScore, compileFormula } from '../scoring/evaluator.js';

describe('compileFormula', () => {
  it('compiles a simple arithmetic formula', () => {
    const fn = compileFormula('a + b');
    expect(fn({ a: 10, b: 20 })).toBe(30);
  });

  it('returns a cached function on second call', () => {
    const fn1 = compileFormula('x * 2');
    const fn2 = compileFormula('x * 2');
    expect(fn1).toBe(fn2);
  });

  it('returns a zero-function for invalid formulas', () => {
    const fn = compileFormula('!!!invalid');
    expect(fn({})).toBe(0);
  });
});

describe('evaluateScore', () => {
  it('evaluates Customer Demand formula with k() scaling', () => {
    const formula = '(k(revenue_at_risk) * date_urgency(target_date) * confidence) + (k(revenue_opportunity) * strategic_weight(strategic_flag) * confidence)';

    // target_date far in the future → date_urgency = 0.2
    // strategic_flag = false → strategic_weight = 1.0
    // k(1000000) = 1000, k(500000) = 500
    const score = evaluateScore(formula, {
      revenue_at_risk: 1000000,
      target_date: '2030-01-01',
      confidence: 0.9,
      revenue_opportunity: 500000,
      strategic_flag: false,
    });

    // k(1000000) * 0.2 * 0.9 + k(500000) * 1.0 * 0.9 = 1000*0.2*0.9 + 500*1.0*0.9 = 180 + 450 = 630
    expect(score).toBe(630);
  });

  it('evaluates Tech Debt formula', () => {
    const formula = '(incident_frequency * blast_radius_weight(blast_radius)) + (support_hours_monthly * 10) + severity_weight(performance_impact) * severity_weight(architectural_risk)';

    const score = evaluateScore(formula, {
      incident_frequency: 12,
      blast_radius: 'platform-wide',
      support_hours_monthly: 18,
      performance_impact: 'critical',
      architectural_risk: 'high',
    });

    // 12 * 1.0 + 18 * 10 + 1.0 * 0.7 = 12 + 180 + 0.7 = 192.7
    expect(score).toBe(192.7);
  });

  it('evaluates Compliance formula with k() scaling', () => {
    const formula = 'k(legal_exposure) * date_urgency(mandate_deadline) * severity_weight(penalty_severity) * confidence';

    const score = evaluateScore(formula, {
      legal_exposure: 5000000,
      mandate_deadline: '2030-06-01',
      penalty_severity: 'critical',
      confidence: 0.95,
    });

    // k(5000000) * 0.2 * 1.0 * 0.95 = 5000 * 0.2 * 1.0 * 0.95 = 950
    expect(score).toBe(950);
  });

  it('evaluates Competitive Gap formula', () => {
    const formula = 'deals_lost * gap_weight(gap_severity) * confidence';

    const score = evaluateScore(formula, {
      deals_lost: 3,
      gap_severity: 'table-stakes',
      confidence: 0.8,
    });

    // 3 * 1.0 * 0.8 = 2.4
    expect(score).toBe(2.4);
  });

  it('evaluates Internal Mandate formula', () => {
    const formula = 'override_weight(priority_override) * date_urgency(target_date)';

    const score = evaluateScore(formula, {
      priority_override: 'critical',
      target_date: '2030-12-01',
    });

    // 1.0 * 0.2 = 0.2
    expect(score).toBe(0.2);
  });

  it('handles missing attributes gracefully', () => {
    const formula = 'revenue_at_risk * confidence';
    const score = evaluateScore(formula, {});
    // undefined * undefined → NaN → clamped to 0
    expect(score).toBe(0);
  });

  it('handles empty attributes', () => {
    const formula = 'deals_lost * gap_weight(gap_severity) * confidence';
    expect(evaluateScore(formula, {})).toBe(0);
  });
});
