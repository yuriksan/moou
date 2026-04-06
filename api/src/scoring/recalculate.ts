import { db } from '../db/index.js';
import { motivations, motivationTypes, outcomes, outcomeMotivations } from '../db/schema.js';
import { eq, sql, and } from 'drizzle-orm';
import { evaluateScore } from './evaluator.js';
import { EFFORT_PENALTY, type EffortSize } from '../types.js';

/**
 * Recalculate score for a single motivation.
 */
export async function recalculateMotivation(motivationId: string): Promise<number> {
  const [m] = await db.select({
    id: motivations.id,
    typeId: motivations.typeId,
    attributes: motivations.attributes,
    status: motivations.status,
  }).from(motivations).where(eq(motivations.id, motivationId)).limit(1);

  if (!m) return 0;

  // Resolved motivations have score 0
  if (m.status === 'resolved') {
    await db.update(motivations).set({ score: '0' }).where(eq(motivations.id, motivationId));
    return 0;
  }

  const [mt] = await db.select({ scoringFormula: motivationTypes.scoringFormula })
    .from(motivationTypes).where(eq(motivationTypes.id, m.typeId)).limit(1);

  if (!mt) return 0;

  const score = evaluateScore(mt.scoringFormula, m.attributes as Record<string, unknown>);
  await db.update(motivations).set({ score: String(score) }).where(eq(motivations.id, motivationId));
  return score;
}

/**
 * Recalculate priority score for a single outcome.
 * priority_score = SUM(linked active motivation scores) - effort_penalty
 */
export async function recalculateOutcome(outcomeId: string): Promise<number> {
  const [o] = await db.select({ effort: outcomes.effort })
    .from(outcomes).where(eq(outcomes.id, outcomeId)).limit(1);
  if (!o) return 0;

  // Sum scores of linked active motivations
  const [result] = await db.select({
    totalScore: sql<string>`coalesce(sum(${motivations.score}), 0)`,
  })
    .from(outcomeMotivations)
    .innerJoin(motivations, and(
      eq(outcomeMotivations.motivationId, motivations.id),
      eq(motivations.status, 'active'),
    ))
    .where(eq(outcomeMotivations.outcomeId, outcomeId)) as any[];

  const totalMotivationScore = Number(result?.totalScore ?? 0);
  const penalty = o.effort ? (EFFORT_PENALTY[o.effort as EffortSize] ?? 0) : 0;
  const priorityScore = Math.max(0, totalMotivationScore - penalty);

  await db.update(outcomes)
    .set({ priorityScore: String(Math.round(priorityScore * 100) / 100) })
    .where(eq(outcomes.id, outcomeId));

  return priorityScore;
}

/**
 * Recalculate all motivation scores, then all outcome priority scores.
 * Used by the daily cron job.
 */
export async function recalculateAll(): Promise<void> {
  console.log('Recalculating all scores...');

  // Get all motivation types with formulas
  const types = await db.select().from(motivationTypes);
  const formulaMap = new Map(types.map(t => [t.id, t.scoringFormula]));

  // Compute all motivation scores in JS, then batch update
  const allMotivations = await db.select({
    id: motivations.id,
    typeId: motivations.typeId,
    attributes: motivations.attributes,
    status: motivations.status,
  }).from(motivations);

  const motUpdates: Array<{ id: string; score: string }> = [];
  for (const m of allMotivations) {
    if (m.status === 'resolved') {
      motUpdates.push({ id: m.id, score: '0' });
      continue;
    }
    const formula = formulaMap.get(m.typeId);
    if (!formula) continue;
    const score = evaluateScore(formula, m.attributes as Record<string, unknown>);
    motUpdates.push({ id: m.id, score: String(score) });
  }

  // Batch update motivation scores (10 at a time to avoid huge queries)
  const BATCH_SIZE = 10;
  for (let i = 0; i < motUpdates.length; i += BATCH_SIZE) {
    const batch = motUpdates.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(u =>
      db.update(motivations).set({ score: u.score }).where(eq(motivations.id, u.id))
    ));
  }

  // Batch update outcome priority scores via single query per batch
  const allOutcomes = await db.select({ id: outcomes.id }).from(outcomes);
  for (let i = 0; i < allOutcomes.length; i += BATCH_SIZE) {
    const batch = allOutcomes.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(o => recalculateOutcome(o.id)));
  }

  console.log(`Recalculated ${allMotivations.length} motivations, ${allOutcomes.length} outcomes.`);
}

/**
 * Recalculate all outcomes linked to a specific motivation.
 */
export async function recalculateLinkedOutcomes(motivationId: string): Promise<void> {
  const links = await db.select({ outcomeId: outcomeMotivations.outcomeId })
    .from(outcomeMotivations)
    .where(eq(outcomeMotivations.motivationId, motivationId));

  for (const link of links) {
    await recalculateOutcome(link.outcomeId);
  }
}
