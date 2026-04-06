import { Router } from 'express';
import { db } from '../db/index.js';
import { tags, outcomeTags, motivationTags, milestoneTags } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

const router = Router();

// POST /tags
router.post('/', async (req, res) => {
  const { name, emoji, colour, description } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
    return;
  }

  // Check case-insensitive uniqueness
  const [existing] = await db.select().from(tags)
    .where(sql`lower(${tags.name}) = lower(${name})`).limit(1);
  if (existing) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Tag "${name}" already exists` } });
    return;
  }

  const [tag] = await db.insert(tags).values({ name, emoji, colour, description }).returning();
  res.status(201).json(tag);
});

// GET /tags
// Returns per-entity usage counts so views can filter their tag lists to only
// the tags that actually apply to that entity type. `usageCount` is the total
// across all entity types and is kept for backwards compat.
router.get('/', async (_req, res) => {
  const allTags = await db.select({
    id: tags.id,
    name: tags.name,
    emoji: tags.emoji,
    colour: tags.colour,
    description: tags.description,
    usageOutcomes: sql<number>`cast((SELECT count(*) FROM outcome_tags WHERE outcome_tags.tag_id = ${tags.id}) as int)`,
    usageMotivations: sql<number>`cast((SELECT count(*) FROM motivation_tags WHERE motivation_tags.tag_id = ${tags.id}) as int)`,
    usageMilestones: sql<number>`cast((SELECT count(*) FROM milestone_tags WHERE milestone_tags.tag_id = ${tags.id}) as int)`,
    usageCount: sql<number>`cast(
      (SELECT count(*) FROM outcome_tags WHERE outcome_tags.tag_id = ${tags.id}) +
      (SELECT count(*) FROM motivation_tags WHERE motivation_tags.tag_id = ${tags.id}) +
      (SELECT count(*) FROM milestone_tags WHERE milestone_tags.tag_id = ${tags.id})
    as int)`,
  }).from(tags).orderBy(tags.name);

  res.json(allTags);
});

// PUT /tags/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, emoji, colour, description } = req.body;

  const [existing] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tag not found' } });
    return;
  }

  // Check uniqueness if name changed
  if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
    const [dup] = await db.select().from(tags)
      .where(sql`lower(${tags.name}) = lower(${name})`).limit(1);
    if (dup) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Tag "${name}" already exists` } });
      return;
    }
  }

  const [updated] = await db.update(tags)
    .set({ name: name ?? existing.name, emoji, colour, description })
    .where(eq(tags.id, id)).returning();

  res.json(updated);
});

// DELETE /tags/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const [existing] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tag not found' } });
    return;
  }

  await db.delete(tags).where(eq(tags.id, id)); // CASCADE handles join tables
  res.status(204).end();
});

export default router;
