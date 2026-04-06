import { Router } from 'express';
import { db } from '../db/index.js';
import { outcomes, outcomeMotivations, motivations, motivationTypes } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { recalculateAll } from '../scoring/recalculate.js';
import { EFFORT_PENALTY, type EffortSize } from '../types.js';

const router = Router();

// POST /scoring/recalculate
router.post('/recalculate', async (_req, res) => {
  await recalculateAll();
  res.json({ status: 'ok', message: 'Recalculation complete' });
});

// GET /outcomes/:id/score
router.get('/outcomes/:id/score', async (req, res) => {
  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!outcome) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  // Get linked motivations with their type info
  const linkedMotivations = await db.select({
    id: motivations.id,
    title: motivations.title,
    typeName: motivationTypes.name,
    status: motivations.status,
    score: motivations.score,
    attributes: motivations.attributes,
  }).from(outcomeMotivations)
    .innerJoin(motivations, eq(outcomeMotivations.motivationId, motivations.id))
    .innerJoin(motivationTypes, eq(motivations.typeId, motivationTypes.id))
    .where(eq(outcomeMotivations.outcomeId, outcome.id));

  const effortPenalty = outcome.effort
    ? (EFFORT_PENALTY[outcome.effort as EffortSize] ?? 0)
    : 0;

  res.json({
    outcomeId: outcome.id,
    priorityScore: outcome.priorityScore,
    effort: outcome.effort,
    effortPenalty,
    motivations: linkedMotivations.map(m => ({
      id: m.id,
      title: m.title,
      type: m.typeName,
      status: m.status,
      score: m.score,
    })),
  });
});

export default router;
