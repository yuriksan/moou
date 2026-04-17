import { describe, it, expect } from 'vitest';
import './setup.js';
import request from 'supertest';
import { app } from '../app.js';

const USER = 'sarah-chen';
const agent = () => request(app).host(''); // Use app directly

// All API routes are under /api/. GET requests now also require auth.
function api() {
  return {
    get: (path: string) => request(app).get(`/api${path}`).set('X-User-Id', USER),
    post: (path: string) => request(app).post(`/api${path}`),
    put: (path: string) => request(app).put(`/api${path}`),
    patch: (path: string) => request(app).patch(`/api${path}`),
    delete: (path: string) => request(app).delete(`/api${path}`),
  };
}

describe('Health', () => {
  it('GET /healthz returns ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Auth', () => {
  it('POST without X-User-Id returns 401', async () => {
    const res = await api().post('/tags').send({ name: 'test' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('POST with invalid user returns 401', async () => {
    const res = await api().post('/tags')
      .set('X-User-Id', 'nonexistent')
      .send({ name: 'test' });
    expect(res.status).toBe(401);
  });

  it('GET without auth returns 401', async () => {
    const res = await request(app).get('/api/tags');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET with valid auth returns 200', async () => {
    const res = await api().get('/tags');
    expect(res.status).toBe(200);
  });
});

describe('Tags', () => {
  it('creates, lists, updates, and deletes a tag', async () => {
    // Create
    const create = await api().post('/tags')
      .set('X-User-Id', USER)
      .send({ name: 'platform', emoji: '🏗️', colour: '#3a8a4a' });
    expect(create.status).toBe(201);
    expect(create.body.name).toBe('platform');
    const tagId = create.body.id;

    // List
    const list = await api().get('/tags');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].usageCount).toBe(0);
    // Per-entity usage counts default to 0 for an unused tag
    expect(list.body[0].usageOutcomes).toBe(0);
    expect(list.body[0].usageMotivations).toBe(0);
    expect(list.body[0].usageMilestones).toBe(0);

    // Update
    const update = await api().put(`/tags/${tagId}`)
      .set('X-User-Id', USER)
      .send({ name: 'Platform', emoji: '🏗️', colour: '#3a8a4a' });
    expect(update.status).toBe(200);
    expect(update.body.name).toBe('Platform');

    // Delete
    const del = await api().delete(`/tags/${tagId}`)
      .set('X-User-Id', USER);
    expect(del.status).toBe(204);
  });

  it('rejects duplicate tag names (case-insensitive)', async () => {
    await api().post('/tags').set('X-User-Id', USER)
      .send({ name: 'EMEA' });
    const dup = await api().post('/tags').set('X-User-Id', USER)
      .send({ name: 'emea' });
    expect(dup.status).toBe(400);
    expect(dup.body.error.message).toContain('already exists');
  });

  it('breaks usage counts down by entity type', async () => {
    // Tag attached only to a motivation, not any outcome — frontend Outcomes
    // view uses usageOutcomes to hide these from its filter bar.
    const tag = await api().post('/tags').set('X-User-Id', USER)
      .send({ name: 'EMEA' });

    // Create a motivation type and link a motivation+tag (mirrors seed data)
    const types = await api().get('/motivation-types');
    const typeId = types.body[0]!.id;
    await api().post('/motivations').set('X-User-Id', USER)
      .send({ typeId, title: 'Acme renewal', tagIds: [tag.body.id] });

    const list = await api().get('/tags');
    const emea = list.body.find((t: any) => t.id === tag.body.id);
    expect(emea.usageOutcomes).toBe(0);
    expect(emea.usageMotivations).toBe(1);
    expect(emea.usageMilestones).toBe(0);
    expect(emea.usageCount).toBe(1);
  });
});

describe('Milestones', () => {
  it('creates and lists milestones with outcome counts', async () => {
    const ms = await api().post('/milestones')
      .set('X-User-Id', USER)
      .send({ name: 'Q3 Release', targetDate: '2026-09-30', type: 'release' });
    expect(ms.status).toBe(201);

    // Create outcome assigned to milestone
    const outcome = await api().post('/outcomes')
      .set('X-User-Id', USER)
      .send({ title: 'Feature A', milestoneId: ms.body.id, effort: 'M' });
    expect(outcome.body.milestoneId).toBe(ms.body.id);

    const list = await api().get('/milestones');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].outcomeCount).toBe(1);
  });

  it('sets outcome milestone_id to null on delete', async () => {
    const ms = await api().post('/milestones')
      .set('X-User-Id', USER)
      .send({ name: 'Temp', targetDate: '2026-06-01' });

    const outcome = await api().post('/outcomes')
      .set('X-User-Id', USER)
      .send({ title: 'Orphaned', milestoneId: ms.body.id });

    await api().delete(`/milestones/${ms.body.id}`)
      .set('X-User-Id', USER);

    const fetched = await api().get(`/outcomes/${outcome.body.id}`);
    expect(fetched.body.milestoneId).toBeNull();
  });
});

describe('Outcomes', () => {
  it('creates an outcome with tags', async () => {
    const tag = await api().post('/tags').set('X-User-Id', USER)
      .send({ name: 'security' });

    const outcome = await api().post('/outcomes')
      .set('X-User-Id', USER)
      .send({ title: 'Fix auth', effort: 'S', tagIds: [tag.body.id] });
    expect(outcome.status).toBe(201);
    expect(outcome.body.effort).toBe('S');

    const detail = await api().get(`/outcomes/${outcome.body.id}`);
    expect(detail.body.tags).toHaveLength(1);
    expect(detail.body.tags[0].name).toBe('security');
  });

  it('lists outcomes with pagination and default sorting', async () => {
    await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'A', status: 'active' });
    await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'B', status: 'active' });
    await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'C', status: 'draft' });

    const all = await api().get('/outcomes');
    expect(all.body.total).toBe(3);

    const active = await api().get('/outcomes?status=active');
    expect(active.body.total).toBe(2);
  });

  it('filters by tags (AND logic)', async () => {
    const t1 = await api().post('/tags').set('X-User-Id', USER).send({ name: 'a' });
    const t2 = await api().post('/tags').set('X-User-Id', USER).send({ name: 'b' });

    const o1 = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Both', tagIds: [t1.body.id, t2.body.id] });
    await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Only A', tagIds: [t1.body.id] });

    const filtered = await api().get('/outcomes?tags=a,b');
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.data[0].id).toBe(o1.body.id);
  });

  it('pins and unpins an outcome', async () => {
    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Pin me' });

    const pinned = await api().patch(`/outcomes/${o.body.id}/pin`)
      .set('X-User-Id', USER);
    expect(pinned.body.pinned).toBe(true);

    const unpinned = await api().patch(`/outcomes/${o.body.id}/pin`)
      .set('X-User-Id', USER);
    expect(unpinned.body.pinned).toBe(false);
  });

  it('records history on create and update', async () => {
    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Track me' });

    await api().put(`/outcomes/${o.body.id}`).set('X-User-Id', USER)
      .send({ title: 'Updated title' });

    const history = await api().get(`/outcomes/${o.body.id}/history`);
    expect(history.body.data.length).toBeGreaterThanOrEqual(2);

    const types = history.body.data.map((h: any) => h.changeType);
    expect(types).toContain('created');
    expect(types).toContain('updated');
  });

  it('deletes outcome and cascades', async () => {
    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Delete me' });

    await api().post(`/outcomes/${o.body.id}/comments`)
      .set('X-User-Id', USER)
      .send({ body: 'A comment' });

    const del = await api().delete(`/outcomes/${o.body.id}`)
      .set('X-User-Id', USER);
    expect(del.status).toBe(204);

    const fetched = await api().get(`/outcomes/${o.body.id}`);
    expect(fetched.status).toBe(404);
  });
});

describe('Motivations', () => {
  let customerDemandTypeId: string;

  it('loads motivation types from seed', async () => {
    const res = await api().get('/motivation-types');
    expect(res.body.length).toBe(5);
    const cd = res.body.find((t: any) => t.name === 'Customer Demand');
    expect(cd).toBeDefined();
    customerDemandTypeId = cd.id;
  });

  it('creates a motivation with validated attributes', async () => {
    const types = await api().get('/motivation-types');
    const typeId = types.body.find((t: any) => t.name === 'Customer Demand').id;

    const m = await api().post('/motivations').set('X-User-Id', USER)
      .send({
        title: 'Acme Corp renewal',
        typeId,
        attributes: {
          customer_name: 'Acme Corp',
          revenue_at_risk: 1800000,
          confidence: 0.9,
          target_date: '2026-05-01',
        },
      });
    expect(m.status).toBe(201);
    // Score should be computed from: revenue_at_risk * date_urgency * confidence
    // Missing fields (revenue_opportunity, strategic_flag) default to 0
    expect(Number(m.body.score)).toBeGreaterThan(0);
  });

  it('rejects invalid attributes', async () => {
    const types = await api().get('/motivation-types');
    const typeId = types.body.find((t: any) => t.name === 'Customer Demand').id;

    const m = await api().post('/motivations').set('X-User-Id', USER)
      .send({
        title: 'Bad attrs',
        typeId,
        attributes: { unknown_field: 'nope' },
      });
    expect(m.status).toBe(400);
    expect(m.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('resolves and reopens a motivation', async () => {
    const types = await api().get('/motivation-types');
    const typeId = types.body.find((t: any) => t.name === 'Tech Debt').id;

    const m = await api().post('/motivations').set('X-User-Id', USER)
      .send({ title: 'Fix flaky tests', typeId, attributes: { incident_frequency: 5 } });

    const resolved = await api().patch(`/motivations/${m.body.id}/resolve`)
      .set('X-User-Id', USER);
    expect(resolved.body.status).toBe('resolved');
    expect(Number(resolved.body.score)).toBe(0);

    const reopened = await api().patch(`/motivations/${m.body.id}/reopen`)
      .set('X-User-Id', USER);
    expect(reopened.body.status).toBe('active');
  });

  it('deletes an unlinked motivation', async () => {
    const types = await api().get('/motivation-types');
    const typeId = types.body[0].id;

    const m = await api().post('/motivations').set('X-User-Id', USER)
      .send({ title: 'Delete me', typeId });

    const del = await api().delete(`/motivations/${m.body.id}`)
      .set('X-User-Id', USER);
    expect(del.status).toBe(204);

    const fetched = await api().get(`/motivations/${m.body.id}`);
    expect(fetched.status).toBe(404);
  });

  it('deletes a linked motivation, unlinks and recalculates outcome', async () => {
    const types = await api().get('/motivation-types');
    const typeId = types.body.find((t: any) => t.name === 'Competitive Gap').id;

    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Affected outcome' });
    const m = await api().post('/motivations').set('X-User-Id', USER)
      .send({ title: 'Will be deleted', typeId, attributes: { deals_lost: 5, gap_severity: 'table-stakes', confidence: 0.8 } });

    await api().post(`/motivations/${m.body.id}/link/${o.body.id}`)
      .set('X-User-Id', USER);

    // Outcome should have a score
    const before = await api().get(`/outcomes/${o.body.id}`);
    expect(Number(before.body.priorityScore)).toBeGreaterThan(0);

    // Delete the motivation
    await api().delete(`/motivations/${m.body.id}`).set('X-User-Id', USER);

    // Outcome score should drop to 0
    const after = await api().get(`/outcomes/${o.body.id}`);
    expect(Number(after.body.priorityScore)).toBe(0);

    // Motivation gone
    const fetched = await api().get(`/motivations/${m.body.id}`);
    expect(fetched.status).toBe(404);
  });
});

describe('Mismatch data', () => {
  it('outcomes list includes milestoneDate and earliestMotivationDate', async () => {
    const types = await api().get('/motivation-types');
    const cdType = types.body.find((t: any) => t.name === 'Customer Demand');

    const ms = await api().post('/milestones').set('X-User-Id', USER)
      .send({ name: 'Mismatch Test', targetDate: '2026-09-30' });
    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'With dates', milestoneId: ms.body.id });
    const m = await api().post('/motivations').set('X-User-Id', USER)
      .send({ title: 'Dated motivation', typeId: cdType.id, attributes: { target_date: '2026-05-01', revenue_at_risk: 100000, confidence: 0.9 } });
    await api().post(`/motivations/${m.body.id}/link/${o.body.id}`).set('X-User-Id', USER);

    const list = await api().get('/outcomes');
    const found = list.body.data.find((item: any) => item.id === o.body.id);
    expect(found.milestoneDate).toBe('2026-09-30');
    expect(found.earliestMotivationDate).toBe('2026-05-01');
  });

  it('motivations list includes earliestMilestoneDate', async () => {
    const types = await api().get('/motivation-types');
    const cdType = types.body.find((t: any) => t.name === 'Customer Demand');

    const ms = await api().post('/milestones').set('X-User-Id', USER)
      .send({ name: 'Ms Test', targetDate: '2026-08-15' });
    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'In milestone', milestoneId: ms.body.id });
    const m = await api().post('/motivations').set('X-User-Id', USER)
      .send({ title: 'Check ms date', typeId: cdType.id, attributes: { target_date: '2026-04-01' } });
    await api().post(`/motivations/${m.body.id}/link/${o.body.id}`).set('X-User-Id', USER);

    const list = await api().get('/motivations');
    const found = list.body.data.find((item: any) => item.id === m.body.id);
    expect(found.earliestMilestoneDate).toBe('2026-08-15');
  });
});

describe('Linking', () => {
  it('links motivation to outcome and updates priority score', async () => {
    const types = await api().get('/motivation-types');
    const typeId = types.body.find((t: any) => t.name === 'Competitive Gap').id;

    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Build feature X' });

    const m = await api().post('/motivations').set('X-User-Id', USER)
      .send({
        title: 'Competitor ships X',
        typeId,
        attributes: { deals_lost: 5, gap_severity: 'table-stakes', confidence: 0.8 },
      });

    // Link
    const link = await api().post(`/motivations/${m.body.id}/link/${o.body.id}`)
      .set('X-User-Id', USER);
    expect(link.status).toBe(201);

    // Check outcome priority updated
    const detail = await api().get(`/outcomes/${o.body.id}`);
    expect(Number(detail.body.priorityScore)).toBeGreaterThan(0);
    expect(detail.body.motivations).toHaveLength(1);

    // Unlink
    const unlink = await api().delete(`/motivations/${m.body.id}/link/${o.body.id}`)
      .set('X-User-Id', USER);
    expect(unlink.status).toBe(204);

    // Score drops back
    const after = await api().get(`/outcomes/${o.body.id}`);
    expect(Number(after.body.priorityScore)).toBe(0);
  });

  it('rejects duplicate links', async () => {
    const types = await api().get('/motivation-types');
    const typeId = types.body[0].id;

    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Outcome' });
    const m = await api().post('/motivations').set('X-User-Id', USER)
      .send({ title: 'Motivation', typeId });

    await api().post(`/motivations/${m.body.id}/link/${o.body.id}`)
      .set('X-User-Id', USER);
    const dup = await api().post(`/motivations/${m.body.id}/link/${o.body.id}`)
      .set('X-User-Id', USER);
    expect(dup.status).toBe(400);
  });
});

describe('Comments', () => {
  it('creates and lists comments on an outcome', async () => {
    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Commented outcome' });

    await api().post(`/outcomes/${o.body.id}/comments`)
      .set('X-User-Id', USER).send({ body: 'First comment' });
    await api().post(`/outcomes/${o.body.id}/comments`)
      .set('X-User-Id', USER).send({ body: 'Second comment' });

    const list = await api().get(`/outcomes/${o.body.id}/comments`);
    expect(list.body.total).toBe(2);
    expect(list.body.data[0].body).toBe('Second comment'); // newest first
  });
});

describe('External Links', () => {
  it('creates and deletes an external link', async () => {
    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Linked outcome' });

    const link = await api().post(`/outcomes/${o.body.id}/external-links`)
      .set('X-User-Id', USER)
      .send({ entityType: 'epic', entityId: 'VE-1042' });
    expect(link.status).toBe(201);
    expect(link.body.provider).toBe('valueedge');
    expect(link.body.entityType).toBe('epic');

    const del = await api().delete(`/external-links/${link.body.id}`)
      .set('X-User-Id', USER);
    expect(del.status).toBe(204);
  });

  it('rejects invalid entity types for configured provider', async () => {
    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Bad link' });

    const link = await api().post(`/outcomes/${o.body.id}/external-links`)
      .set('X-User-Id', USER)
      .send({ entityType: 'invalid_type', entityId: '123' });
    expect(link.status).toBe(400);
    expect(link.body.error.message).toContain('Invalid entityType');
  });
});

describe('Provider', () => {
  it('GET /provider returns configured provider', async () => {
    const res = await api().get('/provider');
    expect(res.body.name).toBe('valueedge');
    expect(res.body.entityTypes.length).toBeGreaterThan(0);
  });
});

describe('Scoring', () => {
  it('GET /outcomes/:id/score returns breakdown', async () => {
    const types = await api().get('/motivation-types');
    const typeId = types.body.find((t: any) => t.name === 'Customer Demand').id;

    const o = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Scored outcome', effort: 'M' });

    const m = await api().post('/motivations').set('X-User-Id', USER)
      .send({
        title: 'Customer need',
        typeId,
        attributes: { revenue_at_risk: 500000, confidence: 0.8, target_date: '2026-06-01' },
      });

    await api().post(`/motivations/${m.body.id}/link/${o.body.id}`)
      .set('X-User-Id', USER);

    const score = await api().get(`/outcomes/${o.body.id}/score`);
    expect(score.status).toBe(200);
    expect(score.body.motivations).toHaveLength(1);
    expect(score.body.effort).toBe('M');
    expect(score.body.effortPenalty).toBe(150);
  });

  it('POST /scoring/recalculate works', async () => {
    const res = await api().post('/scoring/recalculate')
      .set('X-User-Id', USER);
    expect(res.status).toBe(200);
  });
});

describe('Input Validation (API)', () => {
  it('rejects invalid effort on outcome create', async () => {
    const res = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Test', effort: 'HUGE' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('effort');
  });

  it('rejects invalid status on outcome create', async () => {
    const res = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Test', status: 'invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('status');
  });

  it('rejects missing typeId on motivation create', async () => {
    const res = await api().post('/motivations').set('X-User-Id', USER)
      .send({ title: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('typeId');
  });

  it('rejects non-UUID tagIds', async () => {
    const res = await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Test', tagIds: ['not-a-uuid'] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('tagIds');
  });
});

describe('Import Validation', () => {
  it('rejects non-XLSX file', async () => {
    const res = await api().post('/import/timeline/diff')
      .set('X-User-Id', USER)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('this is not an xlsx file'));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Invalid file');
  });
});

describe('Search', () => {
  it('GET /search returns matching outcomes and motivations', async () => {
    const types = await api().get('/motivation-types');
    const typeId = types.body[0].id;

    await api().post('/outcomes').set('X-User-Id', USER)
      .send({ title: 'Searchable Feature' });
    await api().post('/motivations').set('X-User-Id', USER)
      .send({ title: 'Searchable Motivation', typeId });

    const res = await api().get('/search?q=Searchable');
    expect(res.status).toBe(200);
    expect(res.body.outcomes.length).toBeGreaterThanOrEqual(1);
    expect(res.body.motivations.length).toBeGreaterThanOrEqual(1);
    expect(res.body.outcomes[0].title).toContain('Searchable');
  });

  it('GET /search returns empty for no matches', async () => {
    const res = await api().get('/search?q=zzzznothing');
    expect(res.body.outcomes).toHaveLength(0);
    expect(res.body.motivations).toHaveLength(0);
    expect(res.body.tags).toHaveLength(0);
  });

  it('GET /search with empty query returns empty', async () => {
    const res = await api().get('/search?q=');
    expect(res.body.outcomes).toHaveLength(0);
  });

  it('GET /search escapes ILIKE wildcards in the query', async () => {
    // Three outcomes: one matches the literal underscore search, two don't.
    // Without escaping, "C_C" would match all three because _ means "any char".
    await api().post('/outcomes').set('X-User-Id', USER).send({ title: 'C_C literal underscore' });
    await api().post('/outcomes').set('X-User-Id', USER).send({ title: 'CAC alphabetic' });
    await api().post('/outcomes').set('X-User-Id', USER).send({ title: 'CBC alphabetic' });

    const res = await api().get('/search?q=' + encodeURIComponent('C_C'));
    expect(res.status).toBe(200);
    const titles = res.body.outcomes.map((o: any) => o.title);
    expect(titles).toContain('C_C literal underscore');
    expect(titles).not.toContain('CAC alphabetic');
    expect(titles).not.toContain('CBC alphabetic');
  });

  it('GET /search escapes the % wildcard too', async () => {
    await api().post('/outcomes').set('X-User-Id', USER).send({ title: '50% of users' });
    await api().post('/outcomes').set('X-User-Id', USER).send({ title: 'unrelated outcome' });

    const res = await api().get('/search?q=' + encodeURIComponent('50%'));
    const titles = res.body.outcomes.map((o: any) => o.title);
    expect(titles).toContain('50% of users');
    expect(titles).not.toContain('unrelated outcome');
  });
});
