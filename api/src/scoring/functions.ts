/**
 * Built-in scoring functions available in motivation type formulas.
 * Each function is registered with filtrex via extraFunctions.
 */

/**
 * Returns a weight that increases as the date approaches.
 * >90 days = 0.2, 30-90 = 0.5, 7-30 = 0.8, <7 = 1.0, overdue = 1.2
 */
export function date_urgency(dateStr: unknown): number {
  if (!dateStr || typeof dateStr !== 'string') return 0;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return 0;

  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 0) return 1.2;   // overdue
  if (diffDays < 7) return 1.0;
  if (diffDays < 30) return 0.8;
  if (diffDays < 90) return 0.5;
  return 0.2;
}

/**
 * Maps severity enums to numeric weights.
 * critical=1.0, high=0.7, medium=0.4, low=0.1
 */
export function severity_weight(level: unknown): number {
  const map: Record<string, number> = { critical: 1.0, high: 0.7, medium: 0.4, low: 0.1 };
  return map[String(level)] ?? 0;
}

/**
 * Strategic accounts get higher weight. true=1.5, false=1.0
 */
export function strategic_weight(flag: unknown): number {
  return flag ? 1.5 : 1.0;
}

/**
 * Maps priority overrides to weights (same scale as severity).
 */
export function override_weight(level: unknown): number {
  return severity_weight(level);
}

/**
 * Maps blast radius to weights.
 * platform-wide=1.0, service=0.6, component=0.3
 */
export function blast_radius_weight(level: unknown): number {
  const map: Record<string, number> = { 'platform-wide': 1.0, service: 0.6, component: 0.3 };
  return map[String(level)] ?? 0;
}

/**
 * Maps competitive gap severity to weights.
 * table-stakes=1.0, differentiator=0.6, nice-to-have=0.2
 */
export function gap_weight(level: unknown): number {
  const map: Record<string, number> = { 'table-stakes': 1.0, differentiator: 0.6, 'nice-to-have': 0.2 };
  return map[String(level)] ?? 0;
}

/**
 * Scales currency values down by 1000 for readable scores.
 * Users enter real values (£1,800,000), formula uses k(1800000) = 1800.
 */
export function k(value: unknown): number {
  const n = Number(value);
  if (!isFinite(n)) return 0;
  return n / 1000;
}

/** All built-in functions for filtrex registration */
export const scoringFunctions = {
  date_urgency,
  severity_weight,
  strategic_weight,
  k,
  override_weight,
  blast_radius_weight,
  gap_weight,
};
