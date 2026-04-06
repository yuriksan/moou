import { Router } from 'express';
import { db } from '../db/index.js';
import { externalLinks } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { recordHistory } from '../lib/history.js';

const router = Router();

// DELETE /external-links/:id
router.delete('/:id', async (req, res) => {
  const [existing] = await db.select().from(externalLinks).where(eq(externalLinks.id, req.params.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'External link not found' } });
    return;
  }

  await recordHistory('external_link', existing.id, 'deleted', {
    provider: { old: existing.provider, new: null },
    entityType: { old: existing.entityType, new: null },
    entityId: { old: existing.entityId, new: null },
    outcomeId: { old: existing.outcomeId, new: null },
  }, req.user!.id);

  await db.delete(externalLinks).where(eq(externalLinks.id, req.params.id));
  res.status(204).end();
});

export default router;
