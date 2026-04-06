import { Router } from 'express';
import { db } from '../db/index.js';
import { comments, outcomes } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';

const router = Router();

// POST /outcomes/:outcomeId/comments
router.post('/:outcomeId/comments', async (req, res) => {
  const { outcomeId } = req.params;
  const { body } = req.body;

  if (!body || typeof body !== 'string') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'body is required' } });
    return;
  }

  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.id, outcomeId)).limit(1);
  if (!outcome) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  const [comment] = await db.insert(comments).values({
    outcomeId, body, createdBy: req.user!.id,
  }).returning() as any[];

  res.status(201).json(comment);
});

// GET /outcomes/:outcomeId/comments
router.get('/:outcomeId/comments', async (req, res) => {
  const { outcomeId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;

  const result = await db.select().from(comments)
    .where(eq(comments.outcomeId, outcomeId))
    .orderBy(desc(comments.createdAt))
    .limit(limit).offset(offset);

  const [row] = await db.select({ total: sql<number>`cast(count(*) as int)` })
    .from(comments).where(eq(comments.outcomeId, outcomeId));
  const total = row?.total ?? 0;

  res.json({ data: result, total, limit, offset });
});

export default router;
