/**
 * Detect mismatches between a motivation's target date and its outcome's milestone date.
 *
 * Levels:
 * - 'critical' — motivation date is >90 days before milestone date
 * - 'warning' — motivation date is 1-89 days before milestone date
 * - 'ok' — motivation date is on or after milestone date, or no date
 */

export type MismatchLevel = 'critical' | 'warning' | 'ok';

export interface DateMismatch {
  level: MismatchLevel;
  motivationTitle: string;
  motivationDate: string;
  milestoneDate: string;
  daysBefore: number;
  message: string;
}

/** Date attribute keys that motivations may have */
const DATE_ATTR_KEYS = ['target_date', 'mandate_deadline'];

/**
 * Extract the earliest date from a motivation's attributes.
 */
function getMotivationDate(attributes: Record<string, unknown>): string | null {
  for (const key of DATE_ATTR_KEYS) {
    const val = attributes[key];
    if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
      return val;
    }
  }
  return null;
}

/**
 * Check a single motivation against a milestone date.
 */
export function checkMismatch(
  motivation: { title: string; attributes: Record<string, unknown> },
  milestoneDate: string,
): DateMismatch | null {
  const motDate = getMotivationDate(motivation.attributes);
  if (!motDate) return null;

  const motTime = new Date(motDate).getTime();
  const msTime = new Date(milestoneDate).getTime();
  const diffDays = Math.floor((msTime - motTime) / (1000 * 60 * 60 * 24));

  // Motivation date is on or after milestone — no mismatch
  if (diffDays <= 0) return null;

  const level: MismatchLevel = diffDays > 90 ? 'critical' : 'warning';
  const message = level === 'critical'
    ? `${motivation.title} expects delivery by ${motDate}, but milestone targets ${milestoneDate} (${diffDays} days later)`
    : `${motivation.title} expects delivery by ${motDate}, milestone targets ${milestoneDate} (${diffDays} days later)`;

  return {
    level,
    motivationTitle: motivation.title,
    motivationDate: motDate,
    milestoneDate,
    daysBefore: diffDays,
    message,
  };
}

/**
 * Check all motivations on an outcome against its milestone.
 * Returns mismatches sorted by severity (critical first).
 */
export function checkOutcomeMismatches(
  motivations: Array<{ title: string; attributes: Record<string, unknown> }>,
  milestoneDate: string | null,
): DateMismatch[] {
  if (!milestoneDate) return [];

  const mismatches: DateMismatch[] = [];
  for (const m of motivations) {
    const mismatch = checkMismatch(m, milestoneDate);
    if (mismatch) mismatches.push(mismatch);
  }

  // Sort: critical first, then by daysBefore descending
  return mismatches.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'critical' ? -1 : 1;
    return b.daysBefore - a.daysBefore;
  });
}

/**
 * Summarise mismatches for display on a card.
 */
export function mismatchSummary(mismatches: DateMismatch[]): { critical: number; warning: number } {
  return {
    critical: mismatches.filter(m => m.level === 'critical').length,
    warning: mismatches.filter(m => m.level === 'warning').length,
  };
}
