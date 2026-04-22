import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';
import request from 'supertest';
import { app } from '../app.js';

// Track createItem calls so we can assert which entityType was forwarded by the route.
const createItemCalls: Array<{ entityType: string; title: string; description?: string }> = [];
const updateItemCalls: Array<{ entityType: string; entityId: string; changes: any }> = [];

// Mock the adapter for integration tests. createItem rejects PRs (mirroring the
// real GitHub adapter behaviour) and records calls for assertions below.
vi.mock('../providers/adapter.js', () => ({
  getAdapter: () => ({
    name: 'github',
    label: 'GitHub',
    descriptionFormat: 'markdown',
    entityTypes: [
      { name: 'issue', label: 'Issue', default: true },
      { name: 'pr', label: 'Pull Request' },
    ],
    searchItems: vi.fn().mockResolvedValue([
      { entityType: 'issue', entityId: '42', title: 'Test issue', state: 'open', labels: [{ name: 'bug', color: 'd73a4a' }], assignee: { login: 'dev', avatarUrl: 'https://...' }, milestone: null, htmlUrl: 'https://github.com/org/repo/issues/42' },
    ]),
    getItemDetails: vi.fn().mockResolvedValue({
      item: { entityType: 'issue', entityId: '42', title: 'Upstream title', description: 'Upstream desc', state: 'open', labels: [], assignee: null, milestone: null, htmlUrl: 'https://github.com/org/repo/issues/42' },
      etag: '"abc123"',
    }),
    getChildProgress: vi.fn().mockResolvedValue({ total: 3, completed: 1, inProgress: 2 }),
    createItem: vi.fn().mockImplementation(async (_token: string, entityType: string, title: string, description?: string) => {
      createItemCalls.push({ entityType, title, description });
      if (entityType === 'pr') throw new Error('Cannot create pull requests from moou — create an issue instead');
      return { entityId: '99', url: 'https://github.com/org/repo/issues/99' };
    }),
    updateItem: vi.fn().mockImplementation(async (_token: string, entityType: string, entityId: string, changes: any) => {
      updateItemCalls.push({ entityType, entityId, changes });
    }),
  }),
}));

const USER = 'sarah-chen';
function api() {
  return {
    get: (path: string) => request(app).get(`/api${path}`).set('X-User-Id', USER),
    post: (path: string) => request(app).post(`/api${path}`),
    patch: (path: string) => request(app).patch(`/api${path}`),
    put: (path: string) => request(app).put(`/api${path}`),
  };
}

describe('Backend Routes', () => {
  describe('GET /api/backend/entity-types', () => {
    it('returns entity types for configured provider', async () => {
      const res = await api().get('/backend/entity-types');
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe('github');
      expect(res.body.entityTypes).toHaveLength(2);
      expect(res.body.entityTypes[0].name).toBe('issue');
    });
  });

  describe('GET /api/backend/search', () => {
    it('returns search results', async () => {
      const res = await api().get('/backend/search?q=test')
        .set('X-User-Id', USER);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].title).toBe('Test issue');
      expect(res.body.items[0].entityId).toBe('42');
    });

    it('returns empty for blank query', async () => {
      const res = await api().get('/backend/search?q=')
        .set('X-User-Id', USER);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('POST /api/outcomes/:id/connect', () => {
    it('connects an outcome to a backend item', async () => {
      // Create an outcome first
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER)
        .send({ title: 'Connect test' });

      const res = await api().post(`/outcomes/${outcome.body.id}/connect`)
        .set('X-User-Id', USER)
        .send({ entityType: 'issue', entityId: '42' });

      expect(res.status).toBe(201);
      expect(res.body.connectionState).toBe('connected');
      expect(res.body.cachedDetails).toBeDefined();
      expect(res.body.cachedDetails.title).toBe('Upstream title');
      expect(res.body.cachedDetails.childProgress).toEqual({ total: 3, completed: 1, inProgress: 2 });
      expect(res.body.cachedDetails.fetchedAt).toBeDefined();
    });
  });

  describe('POST /api/outcomes/:id/publish', () => {
    beforeEach(() => { createItemCalls.length = 0; });

    it('publishes an outcome as a backend item using the default entity type', async () => {
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER)
        .send({ title: 'Publish test', description: 'Test description' });

      const res = await api().post(`/outcomes/${outcome.body.id}/publish`)
        .set('X-User-Id', USER)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.connectionState).toBe('published');
      expect(res.body.entityId).toBe('99');
      expect(res.body.url).toContain('/issues/99');
      // Default entity type from the mock is 'issue', and the outcome's title +
      // description should have been forwarded to the adapter unchanged.
      expect(createItemCalls).toHaveLength(1);
      expect(createItemCalls[0]!.entityType).toBe('issue');
      expect(createItemCalls[0]!.title).toBe('Publish test');
      expect(createItemCalls[0]!.description).toBe('Test description');

      // Verify descriptionFormat was not changed by publish (stays at default 'plain')
      const outcomeRes = await api().get(`/outcomes/${outcome.body.id}`).set('X-User-Id', USER);
      expect(outcomeRes.body.descriptionFormat).toBe('plain');
    });

    it('honours an explicit entityType from the request body', async () => {
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER)
        .send({ title: 'Explicit type', description: 'desc' });

      const res = await api().post(`/outcomes/${outcome.body.id}/publish`)
        .set('X-User-Id', USER)
        .send({ entityType: 'issue' });

      expect(res.status).toBe(201);
      expect(res.body.entityType).toBe('issue');
      expect(createItemCalls.at(-1)!.entityType).toBe('issue');
    });

    it('rejects publishing as a pull request with a backend error', async () => {
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER)
        .send({ title: 'PR attempt' });

      const res = await api().post(`/outcomes/${outcome.body.id}/publish`)
        .set('X-User-Id', USER)
        .send({ entityType: 'pr' });

      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('BACKEND_ERROR');
      expect(res.body.error.message).toContain('pull requests');
    });

    it('returns 404 when the outcome does not exist', async () => {
      const res = await api().post('/outcomes/00000000-0000-0000-0000-000000000000/publish')
        .set('X-User-Id', USER)
        .send({});
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/external-links/:id/refresh', () => {
    it('refreshes cached details', async () => {
      // Create and connect first
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER)
        .send({ title: 'Refresh test' });

      const link = await api().post(`/outcomes/${outcome.body.id}/connect`)
        .set('X-User-Id', USER)
        .send({ entityType: 'issue', entityId: '42' });

      const res = await api().post(`/external-links/${link.body.id}/refresh`)
        .set('X-User-Id', USER);

      expect(res.status).toBe(200);
      expect(res.body.link).toBeDefined();
      expect(res.body.link.cachedDetails.fetchedAt).toBeDefined();
    });
  });

  describe('PATCH /api/outcomes/:id/primary-link', () => {
    it('sets and clears the primary link', async () => {
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER).send({ title: 'Primary test' });
      const link = await api().post(`/outcomes/${outcome.body.id}/connect`)
        .set('X-User-Id', USER).send({ entityType: 'issue', entityId: '42' });

      // Set primary link
      const set = await api().patch(`/outcomes/${outcome.body.id}/primary-link`)
        .set('X-User-Id', USER).send({ linkId: link.body.id });
      expect(set.status).toBe(200);
      expect(set.body.primaryLinkId).toBe(link.body.id);

      // Clear primary link
      const clear = await api().patch(`/outcomes/${outcome.body.id}/primary-link`)
        .set('X-User-Id', USER).send({ linkId: null });
      expect(clear.status).toBe(200);
      expect(clear.body.primaryLinkId).toBeNull();
    });

    it('returns 400 when linkId belongs to a different outcome', async () => {
      const o1 = await api().post('/outcomes').set('X-User-Id', USER).send({ title: 'O1' });
      const o2 = await api().post('/outcomes').set('X-User-Id', USER).send({ title: 'O2' });
      const link = await api().post(`/outcomes/${o1.body.id}/connect`)
        .set('X-User-Id', USER).send({ entityType: 'issue', entityId: '42' });

      const res = await api().patch(`/outcomes/${o2.body.id}/primary-link`)
        .set('X-User-Id', USER).send({ linkId: link.body.id });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 when outcome does not exist', async () => {
      const res = await api().patch('/outcomes/00000000-0000-0000-0000-000000000000/primary-link')
        .set('X-User-Id', USER).send({ linkId: null });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/outcomes/:id/pull-primary', () => {
    it('pulls title from cached primary item details into the outcome', async () => {
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER).send({ title: 'Old title' });
      const link = await api().post(`/outcomes/${outcome.body.id}/connect`)
        .set('X-User-Id', USER).send({ entityType: 'issue', entityId: '42' });
      await api().patch(`/outcomes/${outcome.body.id}/primary-link`)
        .set('X-User-Id', USER).send({ linkId: link.body.id });

      const res = await api().post(`/outcomes/${outcome.body.id}/pull-primary`)
        .set('X-User-Id', USER).send({ field: 'title' });

      expect(res.status).toBe(200);
      expect(res.body.pulledValue).toBe('Upstream title');
      expect(res.body.outcome.title).toBe('Upstream title');
    });

    it('returns 400 when no primary link is set', async () => {
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER).send({ title: 'No primary' });
      const res = await api().post(`/outcomes/${outcome.body.id}/pull-primary`)
        .set('X-User-Id', USER).send({ field: 'title' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_PRIMARY_LINK');
    });

    it('returns 400 for invalid field value', async () => {
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER).send({ title: 'Test' });
      const link = await api().post(`/outcomes/${outcome.body.id}/connect`)
        .set('X-User-Id', USER).send({ entityType: 'issue', entityId: '42' });
      await api().patch(`/outcomes/${outcome.body.id}/primary-link`)
        .set('X-User-Id', USER).send({ linkId: link.body.id });

      const res = await api().post(`/outcomes/${outcome.body.id}/pull-primary`)
        .set('X-User-Id', USER).send({ field: 'labels' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/outcomes/:id/push-primary', () => {
    beforeEach(() => { updateItemCalls.length = 0; });

    it('calls updateItem with the outcome title and refreshes the link', async () => {
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER).send({ title: 'My outcome title' });
      const link = await api().post(`/outcomes/${outcome.body.id}/connect`)
        .set('X-User-Id', USER).send({ entityType: 'issue', entityId: '42' });
      await api().patch(`/outcomes/${outcome.body.id}/primary-link`)
        .set('X-User-Id', USER).send({ linkId: link.body.id });

      const res = await api().post(`/outcomes/${outcome.body.id}/push-primary`)
        .set('X-User-Id', USER).send({ field: 'title' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(updateItemCalls).toHaveLength(1);
      expect(updateItemCalls[0]!.changes).toEqual({ name: 'My outcome title' });
    });

    it('returns 400 when no primary link is set', async () => {
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER).send({ title: 'No primary' });
      const res = await api().post(`/outcomes/${outcome.body.id}/push-primary`)
        .set('X-User-Id', USER).send({ field: 'title' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_PRIMARY_LINK');
    });

    it('returns 400 for invalid field value', async () => {
      const outcome = await api().post('/outcomes')
        .set('X-User-Id', USER).send({ title: 'Test' });
      const link = await api().post(`/outcomes/${outcome.body.id}/connect`)
        .set('X-User-Id', USER).send({ entityType: 'issue', entityId: '42' });
      await api().patch(`/outcomes/${outcome.body.id}/primary-link`)
        .set('X-User-Id', USER).send({ linkId: link.body.id });

      const res = await api().post(`/outcomes/${outcome.body.id}/push-primary`)
        .set('X-User-Id', USER).send({ field: 'effort' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
