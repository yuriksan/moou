import { Router } from 'express';
import { db } from '../db/index.js';
import { history, users } from '../db/schema.js';
import { eq, and, desc, sql } from 'drizzle-orm';

const router = Router();

const historyFields = {
  id: history.id,
  entityType: history.entityType,
  entityId: history.entityId,
  changeType: history.changeType,
  changes: history.changes,
  changedBy: history.changedBy,
  changedByName: sql<string | null>`(SELECT u.name FROM users u WHERE u.id = history.changed_by)`,
  changedAt: history.changedAt,
};

// GET /outcomes/:id/history
router.get('/outcomes/:id/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const result = await db.select(historyFields).from(history)
    .where(and(
      eq(history.entityType, 'outcome'),
      eq(history.entityId, req.params.id),
    ))
    .orderBy(desc(history.changedAt))
    .limit(limit).offset(offset);

  const [row] = await db.select({ total: sql<number>`cast(count(*) as int)` })
    .from(history)
    .where(and(eq(history.entityType, 'outcome'), eq(history.entityId, req.params.id)));
  const total = row?.total ?? 0;

  res.json({ data: result, total, limit, offset });
});

// GET /motivations/:id/history
router.get('/motivations/:id/history', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Number(req.query.offset) || 0;

  const result = await db.select(historyFields).from(history)
    .where(and(
      eq(history.entityType, 'motivation'),
      eq(history.entityId, req.params.id),
    ))
    .orderBy(desc(history.changedAt))
    .limit(limit).offset(offset);

  const [row2] = await db.select({ total: sql<number>`cast(count(*) as int)` })
    .from(history)
    .where(and(eq(history.entityType, 'motivation'), eq(history.entityId, req.params.id)));
  const total = row2?.total ?? 0;

  res.json({ data: result, total, limit, offset });
});

export default router;
