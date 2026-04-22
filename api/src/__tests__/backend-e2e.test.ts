import { describe, it, expect, vi, beforeEach } from 'vitest';
import './setup.js';
import request from 'supertest';
import { app } from '../app.js';

/**
 * End-to-end integration test for the full backend sync flow:
 *
 *   1. Search GitHub for issues (mocked)
 *   2. Connect a draft outcome to a found issue
 *   3. Verify the link is stored with cached details and a "connected" state
 *   4. Publish a *different* draft outcome as a new GitHub issue
 *   5. Verify the new link is stored with "published" state and the
 *      cached details reflect the freshly created issue
 *   6. Refresh a stale link, exercising the ETag conditional request path
 *      (the mocked adapter returns 'not-modified' on the second call)
 *   7. Verify the refresh updated `fetchedAt` but kept the rest of the
 *      cached details intact
 *
 * This is the test that would catch any regression in the connect+publish+
 * refresh chain — the per-route tests in `backend-routes.test.ts` cover
 * each leg in isolation, but only this test exercises the realistic flow.
 */

// State the mocked adapter mutates over the course of the test. We capture
// every getItemDetails call so we can assert ETag handling, and we toggle
// the "second call returns not-modified" behaviour from the test body.
let getItemCallCount = 0;
let returnNotModifiedNext = false;

const FRESH_ISSUE = {
  entityType: 'issue',
  entityId: '101',
  title: 'Acme renewal — masking perf',
  state: 'open',
  labels: [{ name: 'P1', color: 'd73a4a' }, { name: 'customer', color: '0075ca' }],
  assignee: { login: 'sarah', avatarUrl: 'https://avatars.githubusercontent.com/u/1' },
  milestone: { title: 'Q2 Release', dueOn: '2026-06-30' },
  htmlUrl: 'https://github.com/yuriksan/test-issues/issues/101',
};

const PUBLISHED_ISSUE = {
  entityType: 'issue',
  entityId: '202',
  title: 'Build a thing',  // matches the published outcome's title
  state: 'open',
  labels: [],
  assignee: null,
  milestone: null,
  htmlUrl: 'https://github.com/yuriksan/test-issues/issues/202',
};

vi.mock('../providers/adapter.js', () => ({
  getAdapter: () => ({
    name: 'github',
    label: 'GitHub',
    descriptionFormat: 'markdown',
    entityTypes: [
      { name: 'issue', label: 'Issue', default: true },
      { name: 'pr', label: 'Pull Request' },
    ],

    searchItems: vi.fn().mockImplementation(async (_token: string, q: string) => {
      // The "search" returns the fresh issue when the query matches
      if (q.toLowerCase().includes('acme') || q.toLowerCase().includes('renew')) {
        return [FRESH_ISSUE];
      }
      return [];
    }),

    getItemDetails: vi.fn().mockImplementation(async (_token: string, _type: string, entityId: string, etag?: string) => {
      getItemCallCount++;
      if (returnNotModifiedNext && etag === '"v1"') {
        returnNotModifiedNext = false;
        return 'not-modified';
      }
      // Return the right item based on entityId
      const item = entityId === '101' ? FRESH_ISSUE
                 : entityId === '202' ? PUBLISHED_ISSUE
                 : null;
      if (!item) throw new Error(`unknown entity id ${entityId}`);
      return { item, etag: '"v1"' };
    }),

    getChildProgress: vi.fn().mockResolvedValue({ total: 5, completed: 2, inProgress: 3 }),

    createItem: vi.fn().mockImplementation(async (_token: string, entityType: string, _title: string) => {
      if (entityType !== 'issue') throw new Error('Cannot create pull requests from moou');
      return { entityId: '202', url: 'https://github.com/yuriksan/test-issues/issues/202' };
    }),
  }),
}));

const USER = 'sarah-chen';
function api() {
  return {
    get: (path: string) => request(app).get(`/api${path}`).set('X-User-Id', USER),
    post: (path: string) => request(app).post(`/api${path}`),
  };
}

describe('Backend sync — end-to-end', () => {
  beforeEach(() => {
    getItemCallCount = 0;
    returnNotModifiedNext = false;
  });

  it('walks the full connect → publish → refresh flow', async () => {
    // ─── 1. Create two draft outcomes ───
    const outcomeA = await api().post('/outcomes')
      .set('X-User-Id', USER)
      .send({ title: 'Improve masking performance', description: 'Acme renewal blocker.' });
    expect(outcomeA.status).toBe(201);

    const outcomeB = await api().post('/outcomes')
      .set('X-User-Id', USER)
      .send({ title: 'Build a thing', description: 'A thing worth building.' });
    expect(outcomeB.status).toBe(201);

    // ─── 2. Search GitHub ───
    const searchRes = await api().get('/backend/search?q=acme%20renewal')
      .set('X-User-Id', USER);
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.items).toHaveLength(1);
    expect(searchRes.body.items[0].entityId).toBe('101');
    expect(searchRes.body.items[0].title).toContain('Acme renewal');

    // ─── 3. Connect outcome A to the found issue ───
    const connectRes = await api().post(`/outcomes/${outcomeA.body.id}/connect`)
      .set('X-User-Id', USER)
      .send({ entityType: 'issue', entityId: '101' });
    expect(connectRes.status).toBe(201);
    expect(connectRes.body.connectionState).toBe('connected');
    expect(connectRes.body.entityId).toBe('101');
    expect(connectRes.body.cachedDetails).toBeDefined();
    expect(connectRes.body.cachedDetails.title).toBe('Acme renewal — masking perf');
    expect(connectRes.body.cachedDetails.labels).toHaveLength(2);
    expect(connectRes.body.cachedDetails.assignee.login).toBe('sarah');
    expect(connectRes.body.cachedDetails.milestone.title).toBe('Q2 Release');
    expect(connectRes.body.cachedDetails.childProgress).toEqual({ total: 5, completed: 2, inProgress: 3 });
    expect(connectRes.body.cachedDetails.etag).toBe('"v1"');
    expect(connectRes.body.cachedDetails.fetchedAt).toBeDefined();
    const linkId = connectRes.body.id;
    const initialFetchedAt = connectRes.body.cachedDetails.fetchedAt;
    expect(getItemCallCount).toBe(1); // connect → 1 detail fetch

    // The outcome detail endpoint surfaces the link
    const outcomeDetail = await api().get(`/outcomes/${outcomeA.body.id}`);
    expect(outcomeDetail.status).toBe(200);
    expect(outcomeDetail.body.externalLinks).toHaveLength(1);
    expect(outcomeDetail.body.externalLinks[0].connectionState).toBe('connected');

    // ─── 4. Publish outcome B as a new GitHub issue ───
    const publishRes = await api().post(`/outcomes/${outcomeB.body.id}/publish`)
      .set('X-User-Id', USER)
      .send({ entityType: 'issue' });
    expect(publishRes.status).toBe(201);
    expect(publishRes.body.connectionState).toBe('published');
    expect(publishRes.body.entityId).toBe('202');
    expect(publishRes.body.url).toContain('/issues/202');
    expect(publishRes.body.cachedDetails.title).toBe('Build a thing');
    // Publish triggers one more detail fetch (after creation, to populate cache)
    expect(getItemCallCount).toBe(2);

    // ─── 5. Refresh the connected link with a stale ETag ───
    // First refresh → returns 'not-modified' (etag matches), only fetchedAt updates
    returnNotModifiedNext = true;
    // Sleep a few ms so fetchedAt actually changes
    await new Promise(r => setTimeout(r, 5));
    const refreshRes1 = await api().post(`/external-links/${linkId}/refresh`)
      .set('X-User-Id', USER);
    expect(refreshRes1.status).toBe(200);
    expect(refreshRes1.body.changed).toBe(false);
    expect(refreshRes1.body.link.cachedDetails.title).toBe('Acme renewal — masking perf'); // unchanged
    expect(refreshRes1.body.link.cachedDetails.fetchedAt).not.toBe(initialFetchedAt); // bumped
    expect(getItemCallCount).toBe(3);

    // Second refresh → ETag returns the full item again
    const refreshRes2 = await api().post(`/external-links/${linkId}/refresh`)
      .set('X-User-Id', USER);
    expect(refreshRes2.status).toBe(200);
    expect(refreshRes2.body.changed).toBe(true);
    expect(refreshRes2.body.link.cachedDetails.title).toBe('Acme renewal — masking perf');
    expect(refreshRes2.body.link.cachedDetails.childProgress).toEqual({ total: 5, completed: 2, inProgress: 3 });
    expect(getItemCallCount).toBe(4);
  });

  it('rejects publishing a pull request because PRs cannot be created', async () => {
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
});
