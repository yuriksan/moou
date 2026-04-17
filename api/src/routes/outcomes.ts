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
import { getAdapter } from '../providers/adapter.js';
import { refreshLink } from '../providers/refresh.js';

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

  // Tag filtering (AND logic) — matches direct outcome tags OR tags from linked motivations
  if (req.query.tags) {
    const tagNames = (req.query.tags as string).split(',').map(t => t.toLowerCase());
    const tagRows = await db.select({ id: tags.id }).from(tags)
      .where(inArray(sql`lower(${tags.name})`, tagNames));
    const tagIdList = tagRows.map(t => t.id);

    if (tagIdList.length > 0) {
      // Outcome has each required tag via outcome_tags OR via a linked motivation's tags
      const tagIdSqlValues = sql.join(tagIdList.map(id => sql`${id}::uuid`), sql`, `);
      const matchingOutcomes = await db.execute<{ outcome_id: string }>(sql`
        SELECT o.id AS outcome_id
        FROM outcomes o
        WHERE (
          SELECT count(DISTINCT req.tag_id)
          FROM unnest(ARRAY[${tagIdSqlValues}]) AS req(tag_id)
          WHERE EXISTS (
            SELECT 1 FROM outcome_tags ot WHERE ot.outcome_id = o.id AND ot.tag_id = req.tag_id
          ) OR EXISTS (
            SELECT 1 FROM outcome_motivations om
            JOIN motivation_tags mt ON mt.motivation_id = om.motivation_id
            WHERE om.outcome_id = o.id AND mt.tag_id = req.tag_id
          )
        ) = ${tagIdList.length}
      `);

      const outcomeIds = matchingOutcomes.rows.map((r: any) => r.outcome_id);
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
    primaryLinkId: outcomes.primaryLinkId,
    primaryLinkUrl: sql<string | null>`(SELECT url FROM external_links el WHERE el.id = outcomes.primary_link_id)`,
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
      SELECT min(mot.target_date)
      FROM outcome_motivations om JOIN motivations mot ON mot.id = om.motivation_id
      WHERE om.outcome_id = outcomes.id AND mot.status = 'active' AND mot.target_date IS NOT NULL
    )`,
    tags: sql<{ id: string; name: string; emoji: string | null; colour: string | null }[]>`coalesce(
      (SELECT json_agg(jsonb_build_object('id', tg.id::text, 'name', tg.name, 'emoji', tg.emoji, 'colour', tg.colour))
       FROM (
         SELECT t.id, t.name, t.emoji, t.colour FROM outcome_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.outcome_id = outcomes.id
         UNION
         SELECT t.id, t.name, t.emoji, t.colour FROM outcome_motivations om
           JOIN motivation_tags mt ON mt.motivation_id = om.motivation_id
           JOIN tags t ON t.id = mt.tag_id
           WHERE om.outcome_id = outcomes.id
       ) tg),
      '[]'::json
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

  // Tags — union of directly-applied tags and tags from linked motivations
  // Each tag includes `inherited: true` when it comes only from a motivation (not directly applied)
  const oTags = await db.execute<{ id: string; name: string; emoji: string | null; colour: string | null; inherited: boolean }>(sql`
    SELECT tg.id, tg.name, tg.emoji, tg.colour,
      NOT EXISTS (
        SELECT 1 FROM outcome_tags ot WHERE ot.outcome_id = ${outcome.id} AND ot.tag_id = tg.id
      ) AS inherited
    FROM (
      SELECT t.id, t.name, t.emoji, t.colour
        FROM outcome_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.outcome_id = ${outcome.id}
      UNION
      SELECT t.id, t.name, t.emoji, t.colour
        FROM outcome_motivations om
          JOIN motivation_tags mt ON mt.motivation_id = om.motivation_id
          JOIN tags t ON t.id = mt.tag_id
        WHERE om.outcome_id = ${outcome.id}
    ) tg
  `);
  const oTagList = oTags.rows;

  // ownTagIds — IDs of tags directly assigned to this outcome (not inherited)
  const ownTagIds = oTagList.filter(t => !t.inherited).map(t => t.id);

  // External links
  const links = await db.select().from(externalLinks)
    .where(eq(externalLinks.outcomeId, outcome.id));

  res.json({ ...outcome, motivations: linkedMotivations, tags: oTagList, ownTagIds, externalLinks: links });
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

// ─── Primary item ───

// PATCH /outcomes/:id/primary-link
// Set or clear the primary link for an outcome.
router.patch('/:id/primary-link', async (req, res) => {
  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!outcome) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  const { linkId } = req.body as { linkId: string | null };

  if (linkId !== null && linkId !== undefined) {
    // Verify the link belongs to this outcome
    const [link] = await db.select({ id: externalLinks.id })
      .from(externalLinks)
      .where(and(eq(externalLinks.id, linkId), eq(externalLinks.outcomeId, outcome.id)))
      .limit(1);
    if (!link) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'linkId does not belong to this outcome' } });
      return;
    }
  }

  const newLinkId = linkId ?? null;
  const [updated] = await db.update(outcomes)
    .set({ primaryLinkId: newLinkId, updatedAt: new Date() })
    .where(eq(outcomes.id, req.params.id))
    .returning() as any[];

  await recordHistory('outcome', updated.id, 'updated', {
    primaryLinkId: { old: outcome.primaryLinkId, new: newLinkId },
  }, req.user!.id);
  broadcast({ type: 'outcome_updated', id: updated.id });
  res.json(updated);
});

// POST /outcomes/:id/pull-primary
// Overwrite the outcome's title or description with the cached value from the primary item.
router.post('/:id/pull-primary', async (req, res) => {
  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!outcome) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  if (!outcome.primaryLinkId) {
    res.status(400).json({ error: { code: 'NO_PRIMARY_LINK', message: 'This outcome has no primary item set' } });
    return;
  }

  const field = req.body.field as string | undefined;
  if (field !== 'title' && field !== 'description') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'field must be "title" or "description"' } });
    return;
  }

  const [link] = await db.select().from(externalLinks).where(eq(externalLinks.id, outcome.primaryLinkId)).limit(1);
  if (!link) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Primary link not found' } });
    return;
  }

  // Refresh if cached details are missing or stale (older than 5 minutes)
  const cached = link.cachedDetails as Record<string, unknown> | null;
  const fetchedAt = cached?.fetchedAt as string | undefined;
  const isStale = !fetchedAt || (Date.now() - new Date(fetchedAt).getTime() > 5 * 60 * 1000);
  if (isStale) {
    const token = req.accessToken;
    if (token) await refreshLink(link.id, token);
    // Re-fetch updated link
    const [refreshed] = await db.select().from(externalLinks).where(eq(externalLinks.id, link.id)).limit(1);
    if (refreshed) Object.assign(link, refreshed);
  }

  const details = link.cachedDetails as Record<string, unknown> | null;
  const sourceKey = field === 'title' ? 'title' : 'description';
  const pulledValue = details?.[sourceKey] as string | undefined;

  if (pulledValue === undefined || pulledValue === null) {
    res.status(422).json({ error: { code: 'NO_VALUE', message: `Primary item has no ${field} available` } });
    return;
  }

  const updateField = field === 'title' ? { title: pulledValue } : { description: pulledValue };
  const [updated] = await db.update(outcomes)
    .set({ ...updateField, updatedAt: new Date() })
    .where(eq(outcomes.id, req.params.id))
    .returning() as any[];

  await recordHistory('outcome', updated.id, 'updated', {
    [field]: { old: field === 'title' ? outcome.title : outcome.description, new: pulledValue },
  }, req.user!.id);
  broadcast({ type: 'outcome_updated', id: updated.id });
  res.json({ outcome: updated, pulledValue });
});

// POST /outcomes/:id/push-primary
// Write the outcome's title or description back to the primary backend item.
router.post('/:id/push-primary', async (req, res) => {
  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!outcome) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  if (!outcome.primaryLinkId) {
    res.status(400).json({ error: { code: 'NO_PRIMARY_LINK', message: 'This outcome has no primary item set' } });
    return;
  }

  const field = req.body.field as string | undefined;
  if (field !== 'title' && field !== 'description') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'field must be "title" or "description"' } });
    return;
  }

  const adapter = getAdapter();
  if (!adapter?.updateItem) {
    res.status(400).json({ error: { code: 'NO_ADAPTER', message: 'The configured provider does not support writing back to items' } });
    return;
  }

  const token = req.accessToken;
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const [link] = await db.select().from(externalLinks).where(eq(externalLinks.id, outcome.primaryLinkId)).limit(1);
  if (!link) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Primary link not found' } });
    return;
  }

  const changes = field === 'title'
    ? { name: outcome.title }
    : { description: outcome.description ?? '' };

  try {
    await adapter.updateItem(token, link.entityType, link.entityId, changes);
  } catch (err: any) {
    console.error('push-primary updateItem failed:', err);
    res.status(502).json({ error: { code: 'BACKEND_ERROR', message: err.message || 'Failed to update backend item' } });
    return;
  }

  // Refresh cached details so the UI reflects the change
  await refreshLink(link.id, token);

  res.json({ ok: true });
});

export default router;
