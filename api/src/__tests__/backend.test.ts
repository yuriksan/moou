import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAdapter } from '../providers/github-adapter.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set GITHUB_REPO for tests
process.env.GITHUB_REPO = 'testorg/testrepo';

describe('GitHubAdapter', () => {
  const adapter = new GitHubAdapter();
  const TOKEN = 'test-token';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchItems', () => {
    it('returns mapped items from GitHub search', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { number: 42, title: 'Fix bug', state: 'open', html_url: 'https://github.com/testorg/testrepo/issues/42', labels: [{ name: 'bug', color: 'd73a4a' }], assignee: { login: 'dev', avatar_url: 'https://...' }, milestone: null, pull_request: undefined, draft: false },
            { number: 10, title: 'Add feature', state: 'closed', state_reason: 'completed', html_url: 'https://github.com/testorg/testrepo/issues/10', labels: [], assignee: null, milestone: { title: 'v2.0', due_on: '2026-06-01' }, pull_request: undefined, draft: false },
          ],
        }),
      });

      const items = await adapter.searchItems(TOKEN, 'test query');
      expect(items).toHaveLength(2);
      expect(items[0]!.entityType).toBe('issue');
      expect(items[0]!.title).toBe('Fix bug');
      expect(items[0]!.state).toBe('open');
      expect(items[0]!.labels[0]!.name).toBe('bug');
      expect(items[0]!.assignee?.login).toBe('dev');
      expect(items[1]!.milestone?.title).toBe('v2.0');
    });

    it('returns empty array on API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
      const items = await adapter.searchItems(TOKEN, 'test');
      expect(items).toEqual([]);
    });
  });

  describe('getItemDetails', () => {
    it('returns item details with ETag', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ etag: '"abc123"' }),
        json: async () => ({
          number: 42, title: 'Fix bug', state: 'open', html_url: 'https://...', labels: [], assignee: null, milestone: null, pull_request: undefined, draft: false,
        }),
      });

      const result = await adapter.getItemDetails(TOKEN, 'issue', '42');
      expect(result).not.toBe('not-modified');
      if (result !== 'not-modified') {
        expect(result.item.title).toBe('Fix bug');
        expect(result.etag).toBe('"abc123"');
      }
    });

    it('returns not-modified for 304', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 304 });
      const result = await adapter.getItemDetails(TOKEN, 'issue', '42', '"abc123"');
      expect(result).toBe('not-modified');
    });

    it('detects PRs and merged state', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({}),
        json: async () => ({
          number: 5, title: 'Merge PR', state: 'closed', merged: true, html_url: 'https://...', labels: [], assignee: null, milestone: null, pull_request: undefined, draft: false,
        }),
      });

      const result = await adapter.getItemDetails(TOKEN, 'pr', '5');
      if (result !== 'not-modified') {
        expect(result.item.state).toBe('merged');
      }
    });
  });

  describe('createItem', () => {
    it('creates an issue and returns ID + URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ number: 99, html_url: 'https://github.com/testorg/testrepo/issues/99' }),
      });

      const result = await adapter.createItem(TOKEN, 'issue', 'New issue', 'Description');
      expect(result.entityId).toBe('99');
      expect(result.url).toContain('/issues/99');
    });

    it('rejects PR creation', async () => {
      await expect(adapter.createItem(TOKEN, 'pr', 'Bad')).rejects.toThrow('Cannot create pull requests');
    });
  });

  describe('updateItem', () => {
    it('sends PATCH with title when name is provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await adapter.updateItem(TOKEN, 'issue', '42', { name: 'New title' });
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toContain('/issues/42');
      expect(JSON.parse(opts.body)).toEqual({ title: 'New title' });
    });

    it('sends PATCH with body when description is provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await adapter.updateItem(TOKEN, 'issue', '42', { description: 'New desc' });
      expect(JSON.parse(mockFetch.mock.calls[0]![1].body)).toEqual({ body: 'New desc' });
    });

    it('sends both fields when both provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await adapter.updateItem(TOKEN, 'issue', '42', { name: 'T', description: 'D' });
      expect(JSON.parse(mockFetch.mock.calls[0]![1].body)).toEqual({ title: 'T', body: 'D' });
    });

    it('makes no request when changes is empty', async () => {
      await adapter.updateItem(TOKEN, 'issue', '42', {});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ message: 'Validation failed' }) });
      await expect(adapter.updateItem(TOKEN, 'issue', '42', { name: 'X' })).rejects.toThrow('422');
    });

    it('throws for PR entity type', async () => {
      await expect(adapter.updateItem(TOKEN, 'pr', '5', { name: 'X' })).rejects.toThrow('pull requests');
    });
  });

  describe('getChildProgress', () => {
    it('returns null when sub-issues API unavailable', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const result = await adapter.getChildProgress(TOKEN, 'issue', '42');
      expect(result).toBeNull();
    });

    it('returns progress when sub-issues exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { number: 1, state: 'closed' },
          { number: 2, state: 'open' },
          { number: 3, state: 'closed' },
        ],
      });

      const result = await adapter.getChildProgress(TOKEN, 'issue', '42');
      expect(result).toEqual({ total: 3, completed: 2, inProgress: 1 });
    });
  });

  describe('entityTypes', () => {
    it('has issue as default', () => {
      const defaultType = adapter.entityTypes.find(t => t.default);
      expect(defaultType?.name).toBe('issue');
    });
  });
});
