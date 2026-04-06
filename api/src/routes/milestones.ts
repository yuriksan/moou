import { Router } from 'express';
import { db } from '../db/index.js';
import { milestones, outcomes, milestoneTags, tags } from '../db/schema.js';
import { eq, sql, inArray } from 'drizzle-orm';
import { recordCreate, recordUpdate, recordHistory } from '../lib/history.js';

const router = Router();

// POST /milestones
router.post('/', async (req, res) => {
  const { name, targetDate, type, description, status, tagIds } = req.body;
  if (!name || !targetDate) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name and targetDate are required' } });
    return;
  }

  const [milestone] = await db.insert(milestones).values({
    name, targetDate, type, description,
    status: status ?? 'upcoming',
    createdBy: req.user!.id,
  }).returning() as any[];

  if (tagIds?.length) {
    await db.insert(milestoneTags).values(tagIds.map((tagId: string) => ({ milestoneId: milestone.id, tagId })));
  }

  await recordCreate('milestone', milestone.id, milestone as any, req.user!.id);
  res.status(201).json(milestone);
});

// GET /milestones
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;

  const result = await db.select({
    id: milestones.id,
    name: milestones.name,
    targetDate: milestones.targetDate,
    type: milestones.type,
    description: milestones.description,
    status: milestones.status,
    createdBy: milestones.createdBy,
    createdAt: milestones.createdAt,
    updatedAt: milestones.updatedAt,
    outcomeCount: sql<number>`cast((SELECT count(*) FROM outcomes WHERE outcomes.milestone_id = milestones.id) as int)`,
    effortSummary: sql<Record<string, number>>`(
      SELECT jsonb_object_agg(effort, cnt) FROM (
        SELECT effort, count(*) as cnt FROM outcomes
        WHERE outcomes.milestone_id = milestones.id AND effort IS NOT NULL
        GROUP BY effort
      ) t
    )`,
  }).from(milestones)
    .orderBy(milestones.targetDate)
    .limit(limit).offset(offset);

  const [row] = await db.select({ total: sql<number>`cast(count(*) as int)` }).from(milestones);
  const total = row?.total ?? 0;

  res.json({ data: result, total, limit, offset });
});

// GET /milestones/:id
router.get('/:id', async (req, res) => {
  const [milestone] = await db.select().from(milestones).where(eq(milestones.id, req.params.id)).limit(1);
  if (!milestone) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Milestone not found' } });
    return;
  }

  const milestoneOutcomes = await db.select({
    id: outcomes.id,
    title: outcomes.title,
    effort: outcomes.effort,
    status: outcomes.status,
    priorityScore: outcomes.priorityScore,
    pinned: outcomes.pinned,
  }).from(outcomes)
    .where(eq(outcomes.milestoneId, milestone.id))
    .orderBy(sql`${outcomes.pinned} DESC, ${outcomes.priorityScore} DESC`);

  const mTags = await db.select({ id: tags.id, name: tags.name, emoji: tags.emoji, colour: tags.colour })
    .from(milestoneTags)
    .innerJoin(tags, eq(milestoneTags.tagId, tags.id))
    .where(eq(milestoneTags.milestoneId, milestone.id));

  res.json({ ...milestone, outcomes: milestoneOutcomes, tags: mTags });
});

// PUT /milestones/:id
router.put('/:id', async (req, res) => {
  const [existing] = await db.select().from(milestones).where(eq(milestones.id, req.params.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Milestone not found' } });
    return;
  }

  const { name, targetDate, type, description, status } = req.body;
  const [updated] = await db.update(milestones).set({
    name: name ?? existing.name,
    targetDate: targetDate ?? existing.targetDate,
    type: type !== undefined ? type : existing.type,
    description: description !== undefined ? description : existing.description,
    status: status ?? existing.status,
    updatedAt: new Date(),
  }).where(eq(milestones.id, req.params.id)).returning() as any[];

  await recordUpdate('milestone', updated.id, existing as any, updated as any, req.user!.id);
  res.json(updated);
});

// DELETE /milestones/:id
router.delete('/:id', async (req, res) => {
  const [existing] = await db.select().from(milestones).where(eq(milestones.id, req.params.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Milestone not found' } });
    return;
  }

  // outcomes.milestone_id will be SET NULL by FK constraint
  await db.delete(milestones).where(eq(milestones.id, req.params.id));
  res.status(204).end();
});

export default router;
