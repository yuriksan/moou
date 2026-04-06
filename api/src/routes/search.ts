import { Router } from 'express';
import { db } from '../db/index.js';
import { outcomes, motivations, motivationTypes, tags } from '../db/schema.js';
import { sql, ilike, or } from 'drizzle-orm';

const router = Router();

// GET /search?q=term
router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ outcomes: [], motivations: [], tags: [] });
    return;
  }

  const pattern = `%${q}%`;

  const [matchedOutcomes, matchedMotivations, matchedTags] = await Promise.all([
    db.select({
      id: outcomes.id,
      title: outcomes.title,
      status: outcomes.status,
      priorityScore: outcomes.priorityScore,
      effort: outcomes.effort,
    }).from(outcomes)
      .where(or(
        ilike(outcomes.title, pattern),
        ilike(outcomes.description, pattern),
      ))
      .orderBy(sql`${outcomes.priorityScore} DESC`)
      .limit(10),

    db.select({
      id: motivations.id,
      title: motivations.title,
      typeName: motivationTypes.name,
      score: motivations.score,
      status: motivations.status,
    }).from(motivations)
      .innerJoin(motivationTypes, sql`${motivations.typeId} = ${motivationTypes.id}`)
      .where(or(
        ilike(motivations.title, pattern),
        ilike(motivations.notes, pattern),
      ))
      .orderBy(sql`${motivations.score} DESC`)
      .limit(10),

    db.select({
      id: tags.id,
      name: tags.name,
      emoji: tags.emoji,
      colour: tags.colour,
    }).from(tags)
      .where(ilike(tags.name, pattern))
      .limit(10),
  ]);

  res.json({
    outcomes: matchedOutcomes,
    motivations: matchedMotivations,
    tags: matchedTags,
  });
});

export default router;
