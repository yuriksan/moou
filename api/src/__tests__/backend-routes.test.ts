import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';
import request from 'supertest';
import { app } from '../app.js';

// Track createItem calls so we can assert which entityType was forwarded by the route.
const createItemCalls: Array<{ entityType: string; title: string; description?: string }> = [];

// Mock the adapter for integration tests. createItem rejects PRs (mirroring the
// real GitHub adapter behaviour) and records calls for assertions below.
vi.mock('../providers/adapter.js', () => ({
  getAdapter: () => ({
    name: 'github',
    label: 'GitHub',
    entityTypes: [
      { name: 'issue', label: 'Issue', default: true },
      { name: 'pr', label: 'Pull Request' },
    ],
    searchItems: vi.fn().mockResolvedValue([
      { entityType: 'issue', entityId: '42', title: 'Test issue', state: 'open', labels: [{ name: 'bug', color: 'd73a4a' }], assignee: { login: 'dev', avatarUrl: 'https://...' }, milestone: null, htmlUrl: 'https://github.com/org/repo/issues/42' },
    ]),
    getItemDetails: vi.fn().mockResolvedValue({
      item: { entityType: 'issue', entityId: '42', title: 'Test issue', state: 'open', labels: [], assignee: null, milestone: null, htmlUrl: 'https://github.com/org/repo/issues/42' },
      etag: '"abc123"',
    }),
    getChildProgress: vi.fn().mockResolvedValue({ total: 3, completed: 1, inProgress: 2 }),
    createItem: vi.fn().mockImplementation(async (_token: string, entityType: string, title: string, description?: string) => {
      createItemCalls.push({ entityType, title, description });
      if (entityType === 'pr') throw new Error('Cannot create pull requests from moou — create an issue instead');
      return { entityId: '99', url: 'https://github.com/org/repo/issues/99' };
    }),
  }),
}));

const USER = 'sarah-chen';
function api() {
  return {
    get: (path: string) => request(app).get(`/api${path}`),
    post: (path: string) => request(app).post(`/api${path}`),
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
      expect(res.body.cachedDetails.title).toBe('Test issue');
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
});
