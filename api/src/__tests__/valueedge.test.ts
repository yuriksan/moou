import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValueEdgeAdapter } from '../providers/valueedge-adapter.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

process.env.VALUEEDGE_BASE_URL = 'https://ot-internal.saas.microfocus.com';
process.env.VALUEEDGE_SHARED_SPACE = '4001';
process.env.VALUEEDGE_WORKSPACE = '48001';

const API_BASE = 'https://ot-internal.saas.microfocus.com/api/shared_spaces/4001/workspaces/48001';

describe('ValueEdgeAdapter', () => {
  const adapter = new ValueEdgeAdapter();
  const TOKEN = 'test-lwsso-token';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('entityTypes', () => {
    it('has story as default', () => {
      const defaultType = adapter.entityTypes.find(t => t.default);
      expect(defaultType?.name).toBe('story');
    });

    it('exposes epic, feature, story', () => {
      const names = adapter.entityTypes.map(t => t.name);
      expect(names).toContain('epic');
      expect(names).toContain('feature');
      expect(names).toContain('story');
    });
  });

  describe('searchItems', () => {
    it('returns mapped items from all entity types when no type filter', async () => {
      const storyRes = { ok: true, json: async () => ({ data: [{ id: '101', name: 'Login story', phase: { name: 'In Progress' }, owner: { full_name: 'Alice' } }] }) };
      const featureRes = { ok: true, json: async () => ({ data: [{ id: '201', name: 'Login feature', phase: { name: 'New' }, owner: null }] }) };
      const epicRes = { ok: true, json: async () => ({ data: [] }) };

      // Three parallel fetches — order varies; match by URL
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/epics?')) return Promise.resolve(epicRes);
        if (url.includes('/features?')) return Promise.resolve(featureRes);
        return Promise.resolve(storyRes); // stories
      });

      const items = await adapter.searchItems(TOKEN, 'login');
      expect(items.length).toBeGreaterThanOrEqual(2);
      const story = items.find(i => i.entityType === 'story');
      expect(story?.title).toBe('Login story');
      expect(story?.state).toBe('in progress');
      expect(story?.assignee?.login).toBe('Alice');
      expect(story?.htmlUrl).toContain('101');
      const feature = items.find(i => i.entityType === 'feature');
      expect(feature?.title).toBe('Login feature');
    });

    it('filters to a single entity type when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: '99', name: 'Epic result', phase: { name: 'New' }, owner: null }] }),
      });

      const items = await adapter.searchItems(TOKEN, 'epic', 'epic');
      expect(items).toHaveLength(1);
      expect(items[0]!.entityType).toBe('epic');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]![0]).toContain('/epics?');
    });

    it('returns empty array on API error without throwing', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      const items = await adapter.searchItems(TOKEN, 'anything');
      expect(items).toEqual([]);
    });

    it('encodes the query correctly', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
      await adapter.searchItems(TOKEN, 'my query', 'story');
      const url: string = mockFetch.mock.calls[0]![0];
      // Verify the VE query contains name CONTAINS and the quoted search term
      // (spaces may be encoded as %20 or + — both are valid percent-encoding)
      const decoded = decodeURIComponent(url);
      expect(decoded).toContain('name CONTAINS "my query"');
    });
  });

  describe('getItemDetails', () => {
    it('returns mapped item with ETag', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ etag: '"ver42"' }),
        json: async () => ({ id: '55', name: 'User story title', phase: { name: 'Done' }, owner: null }),
      });

      const result = await adapter.getItemDetails(TOKEN, 'story', '55');
      expect(result).not.toBe('not-modified');
      if (result !== 'not-modified') {
        expect(result.item.entityId).toBe('55');
        expect(result.item.title).toBe('User story title');
        expect(result.item.state).toBe('done');
        expect(result.etag).toBe('"ver42"');
      }
    });

    it('returns not-modified for 304', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 304, headers: new Headers({}) });
      const result = await adapter.getItemDetails(TOKEN, 'story', '55', '"ver42"');
      expect(result).toBe('not-modified');
    });

    it('sends If-None-Match header when etag provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({}),
        json: async () => ({ id: '1', name: 'x', phase: { name: 'New' }, owner: null }),
      });
      await adapter.getItemDetails(TOKEN, 'feature', '1', '"etag123"');
      const reqHeaders = mockFetch.mock.calls[0]![1].headers;
      expect(reqHeaders['If-None-Match']).toBe('"etag123"');
    });

    it('throws on API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, headers: new Headers({}) });
      await expect(adapter.getItemDetails(TOKEN, 'story', '1')).rejects.toThrow('ValueEdge API error: 500');
    });

    it('throws for unknown entity type', async () => {
      await expect(adapter.getItemDetails(TOKEN, 'sprint', '1')).rejects.toThrow('unknown entity type');
    });
  });

  describe('getChildProgress', () => {
    it('returns null for story (no children)', async () => {
      const result = await adapter.getChildProgress(TOKEN, 'story', '1');
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when feature has no child stories', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], total_count: 0 }) });
      const result = await adapter.getChildProgress(TOKEN, 'feature', '10');
      expect(result).toBeNull();
    });

    it('returns progress counts for an epic with features', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: '1', phase: { name: 'New' } },
            { id: '2', phase: { name: 'In Progress' } },
            { id: '3', phase: { name: 'Done' } },
            { id: '4', phase: { name: 'Done' } },
          ],
          total_count: 4,
        }),
      });

      const result = await adapter.getChildProgress(TOKEN, 'epic', '5');
      expect(result).toEqual({ total: 4, completed: 2, inProgress: 1 });
    });

    it('returns null on API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
      const result = await adapter.getChildProgress(TOKEN, 'feature', '10');
      expect(result).toBeNull();
    });

    it('queries children with correct parent filter', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], total_count: 0 }) });
      await adapter.getChildProgress(TOKEN, 'feature', '42');
      const url: string = mockFetch.mock.calls[0]![0];
      expect(url).toContain(`${API_BASE}/stories?`);
      expect(url).toContain('42');
    });
  });

  describe('createItem', () => {
    it('creates an epic and returns id + url', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: '501' }] }),
      });

      const result = await adapter.createItem(TOKEN, 'epic', 'New Epic', 'Description');
      expect(result.entityId).toBe('501');
      expect(result.url).toContain('501');
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.data[0].name).toBe('New Epic');
      // Stable logical phase name is used — no env var needed
      expect(body.data[0].phase.id).toBe('phase.epic.new');
      // Epic parent is always the fixed work_item_root
      expect(body.data[0].parent).toEqual({ type: 'work_item_root', id: '1001' });
    });

    it('creates a feature with a user-supplied parent epic reference', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: '601' }] }),
      });

      const result = await adapter.createItem(TOKEN, 'feature', 'New Feature', undefined, {
        parentEntityId: '800',
        parentEntityType: 'epic',
      });
      expect(result.entityId).toBe('601');
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.data[0].parent).toEqual({ type: 'epic', id: '800' });
      expect(body.data[0].phase.id).toBe('phase.feature.new');
    });

    it('creates a story with a user-supplied parent feature reference', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: '701' }] }),
      });

      const result = await adapter.createItem(TOKEN, 'story', 'New Story', undefined, {
        parentEntityId: '900',
        parentEntityType: 'feature',
      });
      expect(result.entityId).toBe('701');
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.data[0].parent).toEqual({ type: 'feature', id: '900' });
      expect(body.data[0].phase.id).toBe('phase.story.new');
    });

    it('passes extraFields (e.g. priority) through to the request body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: '702' }] }),
      });

      await adapter.createItem(TOKEN, 'story', 'Story With Priority', undefined, {
        parentEntityId: '900',
        parentEntityType: 'feature',
        priority: { type: 'list_node', id: 'list_node.priority.high' },
        story_points: 5,
      });
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.data[0].priority).toEqual({ type: 'list_node', id: 'list_node.priority.high' });
      expect(body.data[0].story_points).toBe(5);
    });

    it('throws when no parent is provided for a feature', async () => {
      await expect(adapter.createItem(TOKEN, 'feature', 'Orphan Feature')).rejects.toThrow('Epic');
    });

    it('throws when no parent is provided for a story', async () => {
      await expect(adapter.createItem(TOKEN, 'story', 'Orphan Story')).rejects.toThrow('Feature');
    });

    it('throws for unsupported entity type', async () => {
      await expect(adapter.createItem(TOKEN, 'task', 'Unsupported')).rejects.toThrow('"task"');
    });

    it('throws with ValueEdge error message on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ description_translated: 'Name is required' }),
      });
      await expect(adapter.createItem(TOKEN, 'epic', '')).rejects.toThrow('Name is required');
    });
  });

  describe('updateItem', () => {
    it('sends PUT with name field', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await adapter.updateItem(TOKEN, 'story', '101', { name: 'Updated title' });
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toContain('/stories/101');
      expect(JSON.parse(opts.body)).toEqual({ data: [{ name: 'Updated title' }] });
    });

    it('sends PUT with description field', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await adapter.updateItem(TOKEN, 'feature', '55', { description: 'New desc' });
      expect(JSON.parse(mockFetch.mock.calls[0]![1].body)).toEqual({ data: [{ description: 'New desc' }] });
    });

    it('sends both fields when both provided', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
      await adapter.updateItem(TOKEN, 'epic', '10', { name: 'T', description: 'D' });
      expect(JSON.parse(mockFetch.mock.calls[0]![1].body)).toEqual({ data: [{ name: 'T', description: 'D' }] });
    });

    it('makes no request when changes is empty', async () => {
      await adapter.updateItem(TOKEN, 'story', '101', {});
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws for unsupported entity type', async () => {
      await expect(adapter.updateItem(TOKEN, 'task', '1', { name: 'X' })).rejects.toThrow('"task"');
    });

    it('throws with ValueEdge error message on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ description_translated: 'Field is read-only' }),
      });
      await expect(adapter.updateItem(TOKEN, 'story', '101', { name: 'X' })).rejects.toThrow('Field is read-only');
    });
  });

  describe('getCreateOptions', () => {
    /** Minimal phase field as returned by /metadata/fields */
    const phaseField = {
      entity_name: 'story',
      name: 'phase',
      label: 'Phase',
      field_type: 'reference',
      required: true,
      visible_in_ui: true,
      editable: true,
      field_type_data: {
        inline: false,
        targets: [{ type: 'phase' }],
      },
    };

    /** Minimal priority field (inline list_node) */
    const priorityField = {
      entity_name: 'story',
      name: 'priority',
      label: 'Priority',
      field_type: 'reference',
      required: false,
      visible_in_ui: true,
      editable: true,
      field_type_data: {
        inline: true,
        targets: [{ type: 'list_node', logical_name: 'priority' }],
      },
    };

    /** Minimal team field (non-inline reference) */
    const teamField = {
      entity_name: 'story',
      name: 'team',
      label: 'Team',
      field_type: 'reference',
      required: false,
      visible_in_ui: true,
      editable: true,
      field_type_data: {
        inline: false,
        targets: [{ type: 'team' }],
      },
    };

    /** A field that is NOT in SURFACE_FIELDS, should be silently dropped */
    const ignoredField = {
      entity_name: 'story',
      name: 'creation_time',
      label: 'Created',
      field_type: 'date',
      required: false,
      visible_in_ui: true,
      editable: true,
      field_type_data: {},
    };

    it('returns null for an unknown entity type', async () => {
      const result = await adapter.getCreateOptions!(TOKEN, 'task');
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns null when the metadata API fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
      const result = await adapter.getCreateOptions!(TOKEN, 'story');
      expect(result).toBeNull();
    });

    it('sets parentEntityType=feature and label=Feature for story', async () => {
      mockFetch.mockResolvedValue({ ok: false }); // no further fetches needed for this check
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }); // metadata
      const result = await adapter.getCreateOptions!(TOKEN, 'story');
      expect(result?.parentEntityType).toBe('feature');
      expect(result?.parentEntityTypeLabel).toBe('Feature');
    });

    it('sets parentEntityType=null for epic (fixed work_item_root parent)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }); // metadata
      const result = await adapter.getCreateOptions!(TOKEN, 'epic');
      expect(result?.parentEntityType).toBeNull();
      expect(result?.parentEntityTypeLabel).toBeNull();
    });

    it('returns phase as list_node field with options fetched from /phases', async () => {
      mockFetch
        .mockResolvedValueOnce({ // metadata
          ok: true,
          json: async () => ({ data: [phaseField] }),
        })
        .mockResolvedValueOnce({ // phases
          ok: true,
          json: async () => ({
            data: [
              { id: 'phase.story.new', name: 'New' },
              { id: 'phase.story.inprogress', name: 'In Progress' },
              // opaque custom phase — should be included (we no longer filter by prefix per adapter logic)
              { id: 'jonym7rvw991gxt6k5xl215xe', name: 'Ready for Review' },
              // phase for a different entity type — still returned (phases API returns all)
              { id: 'phase.feature.new', name: 'Feature New' },
            ],
          }),
        });

      const result = await adapter.getCreateOptions!(TOKEN, 'story');
      const phaseF = result?.fields.find(f => f.name === 'phase');
      expect(phaseF).toBeDefined();
      expect(phaseF?.fieldType).toBe('list_node');
      expect(phaseF?.required).toBe(true);
      // Logical story phases present
      const optionIds = phaseF?.options?.map(o => o.id);
      expect(optionIds).toContain('phase.story.new');
      expect(optionIds).toContain('phase.story.inprogress');
    });

    it('returns priority as list_node field with options from /list_nodes', async () => {
      mockFetch
        .mockResolvedValueOnce({ // metadata
          ok: true,
          json: async () => ({ data: [priorityField] }),
        })
        .mockResolvedValueOnce({ // list_nodes
          ok: true,
          json: async () => ({
            data: [
              { id: 'list_node.priority.low', name: 'Low' },
              { id: 'list_node.priority.medium', name: 'Medium' },
              { id: 'list_node.priority.high', name: 'High' },
            ],
          }),
        });

      const result = await adapter.getCreateOptions!(TOKEN, 'story');
      const priorityF = result?.fields.find(f => f.name === 'priority');
      expect(priorityF?.fieldType).toBe('list_node');
      expect(priorityF?.options).toHaveLength(3);
      expect(priorityF?.options?.[2]).toEqual({ id: 'list_node.priority.high', name: 'High' });
      // Verify the list_nodes query targeted the correct logical name
      const listNodeUrl: string = mockFetch.mock.calls[1]![0];
      expect(decodeURIComponent(listNodeUrl)).toContain('list_root.logical_name="priority"');
    });

    it('returns team as a searchable reference field', async () => {
      mockFetch.mockResolvedValueOnce({ // metadata
        ok: true,
        json: async () => ({ data: [teamField] }),
      });

      const result = await adapter.getCreateOptions!(TOKEN, 'story');
      const teamF = result?.fields.find(f => f.name === 'team');
      expect(teamF?.fieldType).toBe('reference');
      expect(teamF?.searchEntityType).toBe('team');
      expect(teamF?.referenceType).toBe('team');
      expect(teamF?.options).toBeUndefined();
    });

    it('excludes fields not in SURFACE_FIELDS', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [ignoredField] }),
      });

      const result = await adapter.getCreateOptions!(TOKEN, 'story');
      expect(result?.fields.find(f => f.name === 'creation_time')).toBeUndefined();
    });

    it('excludes name, description, and parent even if present in metadata', async () => {
      const nameField = { ...ignoredField, name: 'name', label: 'Name', field_type: 'string' };
      const descField = { ...ignoredField, name: 'description', label: 'Description', field_type: 'memo' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [nameField, descField] }),
      });

      const result = await adapter.getCreateOptions!(TOKEN, 'story');
      expect(result?.fields.find(f => f.name === 'name')).toBeUndefined();
      expect(result?.fields.find(f => f.name === 'description')).toBeUndefined();
    });
  });
});
