import { Router } from 'express';
import { validateMotivationInput } from '../lib/input-validation.js';
import { db } from '../db/index.js';
import {
  motivations, motivationTypes, motivationTags, tags,
  outcomeMotivations, outcomes, milestones,
} from '../db/schema.js';
import { eq, sql, and, inArray, desc, ilike } from 'drizzle-orm';
import { validateAttributes } from '../lib/validate.js';
import { recordCreate, recordUpdate, recordHistory, recordLink, recordUnlink } from '../lib/history.js';
import { recalculateMotivation, recalculateOutcome, recalculateLinkedOutcomes } from '../scoring/recalculate.js';
import { broadcast } from '../sse/emitter.js';

const router = Router();

/** Extract the canonical target date from motivation attributes using the type's schema. */
function derivedTargetDate(attrs: Record<string, unknown>, schema: Record<string, unknown>): string | null {
  const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const dateKey = Object.keys(props).find(k => props[k]?.format === 'date');
  if (!dateKey) return null;
  const val = attrs[dateKey];
  return typeof val === 'string' && val ? val : null;
}

// POST /motivations
router.post('/', async (req, res) => {
  const { title, typeId, attributes, notes, status, tagIds } = req.body;
  const validationError = validateMotivationInput(req.body);
  if (validationError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: validationError } });
    return;
  }

  // Verify type exists
  const [mt] = await db.select().from(motivationTypes).where(eq(motivationTypes.id, typeId)).limit(1);
  if (!mt) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Unknown motivation type' } });
    return;
  }

  // Validate attributes if provided
  const attrs = attributes ?? {};
  if (Object.keys(attrs).length > 0) {
    const validation = await validateAttributes(typeId, attrs);
    if (!validation.valid) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid attributes', details: validation.errors } });
      return;
    }
  }

  const [motivation] = await db.insert(motivations).values({
    title, typeId, attributes: attrs, notes,
    targetDate: derivedTargetDate(attrs, mt.attributeSchema),
    status: status ?? 'active',
    score: '0', // scoring engine will compute
    createdBy: req.user!.id,
  }).returning() as any[];

  if (tagIds?.length) {
    await db.insert(motivationTags).values(
      tagIds.map((tagId: string) => ({ motivationId: motivation.id, tagId }))
    );
  }

  await recordCreate('motivation', motivation.id, motivation as any, req.user!.id);
  await recalculateMotivation(motivation.id);
  const [fresh] = await db.select().from(motivations).where(eq(motivations.id, motivation.id)).limit(1);
  broadcast({ type: 'motivation_created', id: motivation.id });
  res.status(201).json(fresh ?? motivation);
});

// GET /motivations
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;

  const conditions = [];

  if (req.query.type) {
    const [mt] = await db.select({ id: motivationTypes.id }).from(motivationTypes)
      .where(eq(motivationTypes.name, req.query.type as string)).limit(1);
    if (mt) conditions.push(eq(motivations.typeId, mt.id));
  }

  if (req.query.status) {
    conditions.push(eq(motivations.status, req.query.status as string));
  }

  if (req.query.search) {
    conditions.push(ilike(motivations.title, `%${req.query.search}%`));
  }

  if (req.query.tags) {
    const tagNames = (req.query.tags as string).split(',').map(t => t.toLowerCase());
    const tagRows = await db.select({ id: tags.id }).from(tags)
      .where(inArray(sql`lower(${tags.name})`, tagNames));
    const tagIdList = tagRows.map(t => t.id);
    if (tagIdList.length > 0) {
      const matching = await db.select({ motivationId: motivationTags.motivationId })
        .from(motivationTags)
        .where(inArray(motivationTags.tagId, tagIdList))
        .groupBy(motivationTags.motivationId)
        .having(sql`count(distinct ${motivationTags.tagId}) = ${tagIdList.length}`);
      const ids = matching.map(r => r.motivationId);
      if (ids.length > 0) {
        conditions.push(inArray(motivations.id, ids));
      } else {
        res.json({ data: [], total: 0, limit, offset });
        return;
      }
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db.select({
    id: motivations.id,
    typeId: motivations.typeId,
    typeName: motivationTypes.name,
    scoringDescription: motivationTypes.scoringDescription,
    title: motivations.title,
    status: motivations.status,
    notes: motivations.notes,
    attributes: motivations.attributes,
    score: motivations.score,
    createdBy: motivations.createdBy,
    createdAt: motivations.createdAt,
    updatedAt: motivations.updatedAt,
    linkedOutcomeCount: sql<number>`cast((
      SELECT count(*) FROM outcome_motivations WHERE outcome_motivations.motivation_id = ${motivations.id}
    ) as int)`,
    earliestMilestoneDate: sql<string | null>`(
      SELECT min(m.target_date) FROM outcome_motivations om
      JOIN outcomes o ON o.id = om.outcome_id
      JOIN milestones m ON m.id = o.milestone_id
      WHERE om.motivation_id = ${motivations.id}
    )`,
    tags: sql<{id: string; name: string; emoji: string|null; colour: string|null}[]>`coalesce(
      (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'emoji', t.emoji, 'colour', t.colour))
       FROM motivation_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.motivation_id = ${motivations.id}),
      '[]'::json
    )`,
  }).from(motivations)
    .innerJoin(motivationTypes, eq(motivations.typeId, motivationTypes.id))
    .where(where)
    .orderBy(desc(motivations.score))
    .limit(limit).offset(offset);

  const [row] = await db.select({ total: sql<number>`cast(count(*) as int)` }).from(motivations).where(where);
  const total = row?.total ?? 0;

  res.json({ data: result, total, limit, offset });
});

// GET /motivations/:id
router.get('/:id', async (req, res) => {
  const [motivation] = await db.select({
    id: motivations.id,
    typeId: motivations.typeId,
    typeName: motivationTypes.name,
    scoringFormula: motivationTypes.scoringFormula,
    scoringDescription: motivationTypes.scoringDescription,
    title: motivations.title,
    status: motivations.status,
    notes: motivations.notes,
    attributes: motivations.attributes,
    targetDate: motivations.targetDate,
    score: motivations.score,
    createdBy: motivations.createdBy,
    createdAt: motivations.createdAt,
    updatedAt: motivations.updatedAt,
  }).from(motivations)
    .innerJoin(motivationTypes, eq(motivations.typeId, motivationTypes.id))
    .where(eq(motivations.id, req.params.id)).limit(1);

  if (!motivation) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Motivation not found' } });
    return;
  }

  // Linked outcomes (include milestone info for mismatch detection)
  const linkedOutcomes = await db.select({
    id: outcomes.id,
    title: outcomes.title,
    status: outcomes.status,
    priorityScore: outcomes.priorityScore,
    milestoneId: outcomes.milestoneId,
    milestoneName: milestones.name,
    milestoneDate: milestones.targetDate,
  }).from(outcomeMotivations)
    .innerJoin(outcomes, eq(outcomeMotivations.outcomeId, outcomes.id))
    .leftJoin(milestones, eq(outcomes.milestoneId, milestones.id))
    .where(eq(outcomeMotivations.motivationId, motivation.id));

  // Tags
  const mTags = await db.select({ id: tags.id, name: tags.name, emoji: tags.emoji, colour: tags.colour })
    .from(motivationTags)
    .innerJoin(tags, eq(motivationTags.tagId, tags.id))
    .where(eq(motivationTags.motivationId, motivation.id));

  res.json({ ...motivation, outcomes: linkedOutcomes, tags: mTags });
});

// PUT /motivations/:id
router.put('/:id', async (req, res) => {
  const [existing] = await db.select().from(motivations).where(eq(motivations.id, req.params.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Motivation not found' } });
    return;
  }

  const { title, attributes, notes, tagIds } = req.body;

  // Validate attributes if changed
  const newAttrs = attributes ?? existing.attributes;
  if (attributes && Object.keys(attributes).length > 0) {
    const validation = await validateAttributes(existing.typeId, newAttrs);
    if (!validation.valid) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid attributes', details: validation.errors } });
      return;
    }
  }

  const [mt] = await db.select().from(motivationTypes).where(eq(motivationTypes.id, existing.typeId)).limit(1);

  const [updated] = await db.update(motivations).set({
    title: title ?? existing.title,
    attributes: newAttrs,
    targetDate: mt ? derivedTargetDate(newAttrs, mt.attributeSchema) : undefined,
    notes: notes !== undefined ? notes : existing.notes,
    updatedAt: new Date(),
  }).where(eq(motivations.id, req.params.id)).returning() as any[];

  if (tagIds !== undefined) {
    await db.delete(motivationTags).where(eq(motivationTags.motivationId, updated.id));
    if (tagIds.length > 0) {
      await db.insert(motivationTags).values(
        tagIds.map((tagId: string) => ({ motivationId: updated.id, tagId }))
      );
    }
  }

  await recordUpdate('motivation', updated.id, existing as any, updated as any, req.user!.id);
  await recalculateMotivation(updated.id);
  await recalculateLinkedOutcomes(updated.id);
  const [fresh] = await db.select().from(motivations).where(eq(motivations.id, updated.id)).limit(1);
  broadcast({ type: 'motivation_updated', id: updated.id });
  res.json(fresh ?? updated);
});

// PATCH /motivations/:id/resolve
router.patch('/:id/resolve', async (req, res) => {
  const [existing] = await db.select().from(motivations).where(eq(motivations.id, req.params.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Motivation not found' } });
    return;
  }

  const [updated] = await db.update(motivations)
    .set({ status: 'resolved', score: '0', updatedAt: new Date() })
    .where(eq(motivations.id, req.params.id)).returning() as any[];

  await recordHistory('motivation', updated.id, 'resolved', {
    status: { old: 'active', new: 'resolved' },
    score: { old: existing.score, new: '0' },
  }, req.user!.id);
  await recalculateLinkedOutcomes(updated.id);
  broadcast({ type: 'motivation_resolved', id: updated.id });

  res.json(updated);
});

// PATCH /motivations/:id/reopen
router.patch('/:id/reopen', async (req, res) => {
  const [existing] = await db.select().from(motivations).where(eq(motivations.id, req.params.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Motivation not found' } });
    return;
  }

  const [updated] = await db.update(motivations)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(motivations.id, req.params.id)).returning() as any[];

  await recordHistory('motivation', updated.id, 'reopened', {
    status: { old: 'resolved', new: 'active' },
  }, req.user!.id);
  await recalculateMotivation(updated.id);
  await recalculateLinkedOutcomes(updated.id);
  broadcast({ type: 'motivation_reopened', id: updated.id });

  const [fresh] = await db.select().from(motivations).where(eq(motivations.id, updated.id)).limit(1);
  res.json(fresh ?? updated);
});

// DELETE /motivations/:id
router.delete('/:id', async (req, res) => {
  const [existing] = await db.select().from(motivations).where(eq(motivations.id, req.params.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Motivation not found' } });
    return;
  }

  // Unlink from all outcomes and recalculate their scores
  const links = await db.select({ outcomeId: outcomeMotivations.outcomeId })
    .from(outcomeMotivations).where(eq(outcomeMotivations.motivationId, req.params.id));
  await db.delete(outcomeMotivations).where(eq(outcomeMotivations.motivationId, req.params.id));
  for (const link of links) { await recalculateOutcome(link.outcomeId); }

  await recordHistory('motivation', existing.id, 'deleted', { title: { old: existing.title, new: null } }, req.user!.id);
  await db.delete(motivations).where(eq(motivations.id, req.params.id));
  broadcast({ type: 'motivation_deleted', id: existing.id });
  res.status(204).end();
});

// POST /motivations/:id/link/:outcomeId
router.post('/:id/link/:outcomeId', async (req, res) => {
  const motivationId = req.params.id;
  const outcomeId = req.params.outcomeId;

  // Verify both exist
  const [m] = await db.select().from(motivations).where(eq(motivations.id, motivationId)).limit(1);
  if (!m) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Motivation not found' } });
    return;
  }
  const [o] = await db.select().from(outcomes).where(eq(outcomes.id, outcomeId)).limit(1);
  if (!o) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  // Check if already linked
  const [existing] = await db.select().from(outcomeMotivations)
    .where(and(
      eq(outcomeMotivations.outcomeId, outcomeId),
      eq(outcomeMotivations.motivationId, motivationId),
    )).limit(1);
  if (existing) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Already linked' } });
    return;
  }

  await db.insert(outcomeMotivations).values({
    outcomeId, motivationId, createdBy: req.user!.id,
  });

  await recordLink(outcomeId, motivationId, req.user!.id);
  await recalculateOutcome(outcomeId);
  broadcast({ type: 'link_created', id: outcomeId, motivationId });
  res.status(201).json({ outcomeId, motivationId });
});

// DELETE /motivations/:id/link/:outcomeId
router.delete('/:id/link/:outcomeId', async (req, res) => {
  const motivationId = req.params.id;
  const outcomeId = req.params.outcomeId;

  const [existing] = await db.select().from(outcomeMotivations)
    .where(and(
      eq(outcomeMotivations.outcomeId, outcomeId),
      eq(outcomeMotivations.motivationId, motivationId),
    )).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Link not found' } });
    return;
  }

  await db.delete(outcomeMotivations).where(and(
    eq(outcomeMotivations.outcomeId, outcomeId),
    eq(outcomeMotivations.motivationId, motivationId),
  ));

  await recordUnlink(outcomeId, motivationId, req.user!.id);
  await recalculateOutcome(outcomeId);
  broadcast({ type: 'link_deleted', id: outcomeId, motivationId });
  res.status(204).end();
});

export default router;
