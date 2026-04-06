import { Router } from 'express';
import { db } from '../db/index.js';
import {
  outcomes, outcomeTags, tags, outcomeMotivations, motivations, motivationTypes,
  externalLinks, comments,
} from '../db/schema.js';
import { eq, sql, and, inArray, desc, asc } from 'drizzle-orm';
import { recordCreate, recordUpdate, recordHistory } from '../lib/history.js';
import { flatDiff } from '../lib/diff.js';
import { broadcast } from '../sse/emitter.js';
import { getProvider, isValidEntityType } from '../providers.js';
import { validateOutcomeInput } from '../lib/input-validation.js';

const router = Router();

// POST /outcomes
router.post('/', async (req, res) => {
  const validationError = validateOutcomeInput(req.body);
  if (validationError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: validationError } });
    return;
  }
  const { title, description, effort, milestoneId, status, pinned, tagIds } = req.body;

  const [outcome] = await db.insert(outcomes).values({
    title, description, effort,
    milestoneId: milestoneId ?? null,
    status: status ?? 'draft',
    pinned: pinned ?? false,
    createdBy: req.user!.id,
  }).returning() as any[];

  if (tagIds?.length) {
    await db.insert(outcomeTags).values(
      tagIds.map((tagId: string) => ({ outcomeId: outcome.id, tagId }))
    );
  }

  await recordCreate('outcome', outcome.id, outcome as any, req.user!.id);
  broadcast({ type: 'outcome_created', id: outcome.id });
  res.status(201).json(outcome);
});

// GET /outcomes
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;

  // Build conditions
  const conditions = [];
  if (req.query.status) {
    const statuses = (req.query.status as string).split(',');
    conditions.push(inArray(outcomes.status, statuses));
  }

  // Tag filtering (AND logic)
  if (req.query.tags) {
    const tagNames = (req.query.tags as string).split(',').map(t => t.toLowerCase());
    const tagRows = await db.select({ id: tags.id }).from(tags)
      .where(inArray(sql`lower(${tags.name})`, tagNames));
    const tagIdList = tagRows.map(t => t.id);

    if (tagIdList.length > 0) {
      const matchingOutcomes = await db
        .select({ outcomeId: outcomeTags.outcomeId })
        .from(outcomeTags)
        .where(inArray(outcomeTags.tagId, tagIdList))
        .groupBy(outcomeTags.outcomeId)
        .having(sql`count(distinct ${outcomeTags.tagId}) = ${tagIdList.length}`);

      const outcomeIds = matchingOutcomes.map(r => r.outcomeId);
      if (outcomeIds.length > 0) {
        conditions.push(inArray(outcomes.id, outcomeIds));
      } else {
        res.json({ data: [], total: 0, limit, offset });
        return;
      }
    }
  }

  // Motivation type filtering
  if (req.query.motivationType) {
    const [mt] = await db.select({ id: motivationTypes.id }).from(motivationTypes)
      .where(eq(motivationTypes.name, req.query.motivationType as string)).limit(1);
    if (mt) {
      const linked = await db.selectDistinct({ outcomeId: outcomeMotivations.outcomeId })
        .from(outcomeMotivations)
        .innerJoin(motivations, eq(outcomeMotivations.motivationId, motivations.id))
        .where(eq(motivations.typeId, mt.id));
      const ids = linked.map(r => r.outcomeId);
      if (ids.length > 0) {
        conditions.push(inArray(outcomes.id, ids));
      } else {
        res.json({ data: [], total: 0, limit, offset });
        return;
      }
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const result = await db.select({
    id: outcomes.id,
    title: outcomes.title,
    description: outcomes.description,
    effort: outcomes.effort,
    milestoneId: outcomes.milestoneId,
    status: outcomes.status,
    pinned: outcomes.pinned,
    priorityScore: outcomes.priorityScore,
    createdBy: outcomes.createdBy,
    createdAt: outcomes.createdAt,
    updatedAt: outcomes.updatedAt,
    motivationCount: sql<number>`cast((
      SELECT count(*) FROM outcome_motivations WHERE outcome_motivations.outcome_id = ${outcomes.id}
    ) as int)`,
    milestoneDate: sql<string | null>`(
      SELECT m.target_date FROM milestones m WHERE m.id = outcomes.milestone_id
    )`,
    earliestMotivationDate: sql<string | null>`(
      SELECT min(d) FROM (
        SELECT (mot.attributes->>'target_date')::date AS d
        FROM outcome_motivations om JOIN motivations mot ON mot.id = om.motivation_id
        WHERE om.outcome_id = outcomes.id AND mot.status = 'active' AND mot.attributes->>'target_date' IS NOT NULL
        UNION ALL
        SELECT (mot.attributes->>'mandate_deadline')::date AS d
        FROM outcome_motivations om JOIN motivations mot ON mot.id = om.motivation_id
        WHERE om.outcome_id = outcomes.id AND mot.status = 'active' AND mot.attributes->>'mandate_deadline' IS NOT NULL
      ) dates
    )`,
  }).from(outcomes)
    .where(where)
    .orderBy(desc(outcomes.pinned), desc(outcomes.priorityScore), desc(outcomes.createdAt))
    .limit(limit).offset(offset);

  const [row] = await db.select({ total: sql<number>`cast(count(*) as int)` }).from(outcomes).where(where);
  const total = row?.total ?? 0;

  res.json({ data: result, total, limit, offset });
});

// GET /outcomes/:id
router.get('/:id', async (req, res) => {
  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!outcome) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  // Linked motivations
  const linkedMotivations = await db.select({
    id: motivations.id,
    typeId: motivations.typeId,
    typeName: motivationTypes.name,
    title: motivations.title,
    status: motivations.status,
    score: motivations.score,
    attributes: motivations.attributes,
    createdBy: motivations.createdBy,
  }).from(outcomeMotivations)
    .innerJoin(motivations, eq(outcomeMotivations.motivationId, motivations.id))
    .innerJoin(motivationTypes, eq(motivations.typeId, motivationTypes.id))
    .where(eq(outcomeMotivations.outcomeId, outcome.id));

  // Tags
  const oTags = await db.select({ id: tags.id, name: tags.name, emoji: tags.emoji, colour: tags.colour })
    .from(outcomeTags)
    .innerJoin(tags, eq(outcomeTags.tagId, tags.id))
    .where(eq(outcomeTags.outcomeId, outcome.id));

  // External links
  const links = await db.select().from(externalLinks)
    .where(eq(externalLinks.outcomeId, outcome.id));

  res.json({ ...outcome, motivations: linkedMotivations, tags: oTags, externalLinks: links });
});

// PUT /outcomes/:id
router.put('/:id', async (req, res) => {
  const [existing] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  const { title, description, effort, milestoneId, status, tagIds } = req.body;
  const [updated] = await db.update(outcomes).set({
    title: title ?? existing.title,
    description: description !== undefined ? description : existing.description,
    effort: effort !== undefined ? effort : existing.effort,
    milestoneId: milestoneId !== undefined ? milestoneId : existing.milestoneId,
    status: status ?? existing.status,
    updatedAt: new Date(),
  }).where(eq(outcomes.id, req.params.id)).returning() as any[];

  // Handle tag changes
  if (tagIds !== undefined) {
    await db.delete(outcomeTags).where(eq(outcomeTags.outcomeId, updated.id));
    if (tagIds.length > 0) {
      await db.insert(outcomeTags).values(
        tagIds.map((tagId: string) => ({ outcomeId: updated.id, tagId }))
      );
    }
  }

  await recordUpdate('outcome', updated.id, existing as any, updated as any, req.user!.id);
  broadcast({ type: 'outcome_updated', id: updated.id });
  res.json(updated);
});

// PATCH /outcomes/:id/pin
router.patch('/:id/pin', async (req, res) => {
  const [existing] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  const newPinned = !existing.pinned;
  const [updated] = await db.update(outcomes)
    .set({ pinned: newPinned, updatedAt: new Date() })
    .where(eq(outcomes.id, req.params.id)).returning() as any[];

  await recordHistory('outcome', updated.id, newPinned ? 'pinned' : 'unpinned', {
    pinned: { old: existing.pinned, new: newPinned },
  }, req.user!.id);
  broadcast({ type: 'outcome_updated', id: updated.id });

  res.json(updated);
});

// DELETE /outcomes/:id
router.delete('/:id', async (req, res) => {
  const [existing] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  await recordHistory('outcome', existing.id, 'deleted', { title: { old: existing.title, new: null } }, req.user!.id);
  await db.delete(outcomes).where(eq(outcomes.id, req.params.id));
  broadcast({ type: 'outcome_deleted', id: existing.id });
  res.status(204).end();
});

// ─── External Links (nested under outcomes) ───

// POST /outcomes/:id/external-links
router.post('/:id/external-links', async (req, res) => {
  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!outcome) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  const { entityType, entityId, url } = req.body;
  if (!entityType || !entityId) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'entityType and entityId are required' } });
    return;
  }

  const provider = getProvider();
  // 'link' is always valid as a generic URL link type
  if (entityType !== 'link' && !isValidEntityType(entityType)) {
    const validTypes = provider.entityTypes.map(t => t.name).join(', ');
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: `Invalid entityType "${entityType}" for provider ${provider.label}. Valid types: ${validTypes}, link` },
    });
    return;
  }

  const [link] = await db.insert(externalLinks).values({
    outcomeId: outcome.id, provider: provider.name, entityType, entityId, url,
    createdBy: req.user!.id,
  }).returning() as any[];

  await recordHistory('external_link', link.id, 'created', {
    provider: { old: null, new: provider.name },
    entityType: { old: null, new: entityType },
    entityId: { old: null, new: entityId },
    outcomeId: { old: null, new: outcome.id },
  }, req.user!.id);

  broadcast({ type: 'external_link_created', id: link.id, outcomeId: outcome.id });
  res.status(201).json(link);
});

export default router;
