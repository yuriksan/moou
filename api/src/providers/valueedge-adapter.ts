import type { ProviderAdapter, BackendItem, ChildProgress, ProviderEntityType, CreateField, CreateOptions } from './adapter.js';
import { ProviderAuthError } from './adapter.js';

/** VE-specific auth error — thrown whenever VE returns 401/403. */
class VEAuthError extends ProviderAuthError {
  constructor(status: number) {
    super(`ValueEdge authentication failed (${status}). Please sign in again.`);
    this.name = 'VEAuthError';
  }
}

const BASE_URL = (process.env.VALUEEDGE_BASE_URL || 'https://ot-internal.saas.microfocus.com').replace(/\/$/, '');
const SHARED_SPACE = process.env.VALUEEDGE_SHARED_SPACE || '4001';
const WORKSPACE = process.env.VALUEEDGE_WORKSPACE || '48001';

function apiBase(): string {
  return `${BASE_URL}/api/shared_spaces/${SHARED_SPACE}/workspaces/${WORKSPACE}`;
}

function itemUrl(_entityType: string, id: string): string {
  return `${BASE_URL}/ui/entity-navigation?p=${SHARED_SPACE}/${WORKSPACE}&entityType=work_item&id=${id}`;
}

/** Build fetch headers — ValueEdge uses the LWSSO_COOKIE_KEY as a cookie */
function headers(token: string): Record<string, string> {
  return {
    'Cookie': `LWSSO_COOKIE_KEY=${token}`,
    'Content-Type': 'application/json',
    'HPECLIENTTYPE': 'HPE_REST_API_TECH_PREVIEW',
  };
}

/** ValueEdge query language: escape double quotes inside a string literal */
function veEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

type VEEntityType = 'epics' | 'features' | 'stories' | 'programs' | 'work_items';

const WORK_ITEMS_PATH = 'work_items';

const ENTITY_PATHS: Record<string, VEEntityType> = {
  epic: 'epics',
  feature: 'features',
  story: 'stories',
  program: 'programs',
};

const ENTITY_LABELS: Record<string, string> = {
  epic: 'Epic',
  feature: 'Feature',
  story: 'Story',
  program: 'Program',
};

/** Stable logical-name phase IDs used when creating new items. */
const DEFAULT_PHASE: Record<string, string> = {
  epic: 'phase.epic.new',
  feature: 'phase.feature.new',
  story: 'phase.story.new',
};

/** Parent type required when creating each entity type. */
const PARENT_TYPE: Record<string, string> = {
  epic: 'work_item_root',
  feature: 'epic',
  story: 'feature',
};

/** Fixed work_item_root ID (always "Backlog" in every VE workspace). */
const WORK_ITEM_ROOT_ID = '1001';

/** Derive a simple phase-like state label from the phase reference name */
function deriveState(item: any): string {
  const phaseName: string = item.phase?.name || item.phase?.label || '';
  return phaseName.toLowerCase() || 'unknown';
}

/** Map a raw ValueEdge entity (epic/feature/story/work_item) to a BackendItem */
function mapItem(entityType: string, data: any): BackendItem {
  // work_items endpoint returns a subtype field with the real type (epic/feature/story)
  const resolvedType = entityType === 'work_item' ? (data.subtype || 'epic') : entityType;
  return {
    entityType: resolvedType,
    entityId: String(data.id),
    title: data.name || '',
    description: data.description || undefined,
    state: deriveState(data),
    labels: [],
    assignee: data.owner
      ? { login: data.owner.full_name || data.owner.name || data.owner.id }
      : undefined,
    htmlUrl: '',
  };
}

export class ValueEdgeAdapter implements ProviderAdapter {
  name = 'valueedge';
  label = 'OpenText ValueEdge';
  descriptionFormat = 'html' as const;
  entityTypes: ProviderEntityType[] = [
    { name: 'story', label: 'Story', default: true, parentEntityType: 'feature' },
    { name: 'feature', label: 'Feature', parentEntityType: 'epic' },
    { name: 'epic', label: 'Epic', parentEntityType: 'program' },
  ];

  async searchItems(token: string, query: string, entityType?: string): Promise<BackendItem[]> {
    const types: string[] = entityType && ENTITY_PATHS[entityType]
      ? [entityType]
      : ['epic', 'feature', 'story'];

    const results: BackendItem[] = [];

    await Promise.all(types.map(async (type) => {
      const path = ENTITY_PATHS[type]!;
      const fields = type === 'program' ? 'id,name' : 'id,name,description,phase,owner';
      const q = encodeURIComponent(`"name='*${veEscape(query)}*'"`);
      const url = `${apiBase()}/${path}?query=${q}&fields=${fields}&limit=10`;

      try {
        const res = await fetch(url, { headers: headers(token) });
        if (res.status === 401 || res.status === 403) throw new VEAuthError(res.status);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.error(`ValueEdge search ${type} failed: ${res.status}`, body.slice(0, 200));
          return;
        }
        const data = await res.json() as { data?: any[] };
        for (const item of data.data ?? []) {
          results.push(mapItem(type, item));
        }
      } catch (err) {
        if (err instanceof VEAuthError) throw err; // propagate auth errors
        console.error(`ValueEdge search ${type} error:`, err);
      }
    }));

    return results;
  }

  async getItemDetails(
    token: string,
    _entityType: string,
    entityId: string,
    etag?: string,
  ): Promise<{ item: BackendItem; etag?: string } | 'not-modified'> {
    // Always use the generic work_items endpoint — it returns subtype so we don't
    // need to know the specific type upfront. mapItem resolves subtype → entityType.
    const url = `${apiBase()}/${WORK_ITEMS_PATH}/${entityId}?fields=id,name,description,phase,owner,parent,subtype`;
    const reqHeaders: Record<string, string> = headers(token);
    if (etag) reqHeaders['If-None-Match'] = etag;

    const res = await fetch(url, { headers: reqHeaders });

    if (res.status === 304) return 'not-modified';
    if (res.status === 401 || res.status === 403) throw new VEAuthError(res.status);

    if (!res.ok) {
      throw new Error(`ValueEdge API error: ${res.status} fetching work_item ${entityId}`);
    }

    const data = await res.json();
    const newEtag = res.headers.get('etag') || undefined;
    // mapItem uses data.subtype as the resolved entityType
    return { item: mapItem('work_item', data), etag: newEtag };
  }

  async getChildProgress(token: string, entityType: string, entityId: string): Promise<ChildProgress | null> {
    // epics have features as children; features have stories as children
    const childTypes: Record<string, VEEntityType> = {
      epic: 'features',
      feature: 'stories',
    };

    const childPath = childTypes[entityType];
    if (!childPath) return null;

    // Query children whose parent matches this entity
    const q = encodeURIComponent(`parent EQ {id="${entityId}"}`);
    const url = `${apiBase()}/${childPath}?query=${q}&fields=id,phase&limit=200`;

    try {
      const res = await fetch(url, { headers: headers(token) });
      if (!res.ok) return null;

      const data = await res.json() as { data?: any[]; total_count?: number };
      const items = data.data ?? [];
      if (items.length === 0) return null;

      const total = data.total_count ?? items.length;
      const completed = items.filter((i: any) => {
        const phaseName: string = (i.phase?.name || i.phase?.label || '').toLowerCase();
        return phaseName === 'done' || phaseName === 'closed' || phaseName === 'accepted';
      }).length;
      const inProgress = items.filter((i: any) => {
        const phaseName: string = (i.phase?.name || i.phase?.label || '').toLowerCase();
        return phaseName !== 'done' && phaseName !== 'closed' && phaseName !== 'accepted'
          && phaseName !== 'new' && phaseName !== 'backlog';
      }).length;

      return { total, completed, inProgress };
    } catch {
      return null;
    }
  }

  async createItem(
    token: string,
    entityType: string,
    title: string,
    description?: string,
    options?: { parentEntityId?: string; parentEntityType?: string; [key: string]: any },
  ): Promise<{ entityId: string; url: string }> {
    const path = ENTITY_PATHS[entityType];
    if (!path) {
      throw new Error(`ValueEdge adapter does not support entity type "${entityType}"`);
    }

    const phaseId = DEFAULT_PHASE[entityType];
    if (!phaseId) {
      throw new Error(`No default phase configured for entity type "${entityType}"`);
    }

    const body: Record<string, any> = {
      data: [
        {
          name: title,
          description: description ?? '',
          phase: { type: 'phase', id: phaseId },
        },
      ],
    };

    const requiredParentType = PARENT_TYPE[entityType];
    if (requiredParentType) {
      let parentId: string;
      let parentType: string;

      if (requiredParentType === 'work_item_root') {
        // Epics always hang off the single workspace Backlog root — no picker needed
        parentId = WORK_ITEM_ROOT_ID;
        parentType = 'work_item_root';
      } else {
        parentId = options?.parentEntityId || '';
        parentType = options?.parentEntityType || requiredParentType;
        if (!parentId) {
          const label = ENTITY_LABELS[requiredParentType] || requiredParentType;
          throw new Error(`Cannot create ${ENTITY_LABELS[entityType]} — a parent ${label} must be selected`);
        }
      }

      body.data[0].parent = { type: parentType, id: parentId };
    }

    // Pass through any extra fields (team, release, sprint, priority, story_points, etc.)
    if (options) {
      const { parentEntityId: _p, parentEntityType: _pt, ...extra } = options;
      for (const [key, val] of Object.entries(extra)) {
        if (val !== undefined && val !== null && val !== '') {
          body.data[0][key] = val;
        }
      }
    }

    const res = await fetch(`${apiBase()}/${path}`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new VEAuthError(res.status);
      const err = await res.json().catch(() => ({})) as any;
      const msg = err.description_translated || err.description || err.technical_error || 'failed to create item';
      throw new Error(`ValueEdge API error: ${res.status} — ${msg}`);
    }

    const result = await res.json() as { data?: Array<{ id: string }> };
    const created = result.data?.[0];
    if (!created?.id) {
      throw new Error(`ValueEdge: unexpected response when creating ${entityType}`);
    }

    return { entityId: String(created.id), url: itemUrl(entityType, String(created.id)) };
  }

  async updateItem(token: string, entityType: string, entityId: string, changes: { name?: string; description?: string }): Promise<void> {
    const path = ENTITY_PATHS[entityType];
    if (!path) throw new Error(`ValueEdge adapter does not support entity type "${entityType}"`);

    const payload: Record<string, string> = {};
    if (changes.name !== undefined) payload.name = changes.name;
    if (changes.description !== undefined) payload.description = changes.description;
    if (Object.keys(payload).length === 0) return;

    const res = await fetch(`${apiBase()}/${path}/${encodeURIComponent(entityId)}`, {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({ data: [payload] }),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new VEAuthError(res.status);
      const err = await res.json().catch(() => ({})) as any;
      const msg = err.description_translated || err.description || err.technical_error || 'failed to update item';
      throw new Error(`ValueEdge API error: ${res.status} — ${msg}`);
    }
  }

  async getCreateOptions(token: string, entityType: string): Promise<import('./adapter.js').CreateOptions | null> {
    const path = ENTITY_PATHS[entityType];
    if (!path) return null;

    // Fetch field metadata for this entity type
    const metaRes = await fetch(`${apiBase()}/metadata/fields?entity_name=${encodeURIComponent(entityType)}`, {
      headers: headers(token),
    });
    if (!metaRes.ok) return null;

    const metaData = await metaRes.json() as { data?: any[] };
    const allFields: any[] = (metaData.data ?? []).filter((f: any) =>
      f.entity_name === entityType && f.visible_in_ui && f.editable,
    );

    // Fields we surface in the publish form (required + key optional)
    const SURFACE_FIELDS = new Set([
      'name', 'description', 'parent', 'phase',                   // always
      'team', 'release', 'sprint', 'priority', 'story_points',    // story/feature
      'owner',                                                      // all
    ]);

    const fields: import('./adapter.js').CreateField[] = [];

    for (const f of allFields) {
      if (!SURFACE_FIELDS.has(f.name)) continue;
      // name, description, and parent are handled specially in the form — skip
      if (['name', 'description', 'parent'].includes(f.name)) continue;

      const base = {
        name: f.name as string,
        label: f.label as string,
        fieldType: f.field_type as import('./adapter.js').FieldType,
        required: !!f.required,
      };

      if (f.field_type === 'reference') {
        const target = f.field_type_data?.targets?.[0];
        const targetType: string = target?.type || '';
        const isInline: boolean = !!f.field_type_data?.inline;

        if (isInline && targetType === 'list_node') {
          // Fetch allowed values from list_nodes
          const logicalName: string = target?.logical_name || '';
          let options: import('./adapter.js').CreateFieldOption[] = [];
          if (logicalName) {
            try {
              const q = encodeURIComponent(`list_root.logical_name="${logicalName}"`);
              const lnRes = await fetch(`${apiBase()}/list_nodes?query=${q}&fields=id,name&limit=50`, {
                headers: headers(token),
              });
              if (lnRes.ok) {
                const lnData = await lnRes.json() as { data?: any[] };
                options = (lnData.data ?? []).map((n: any) => ({ id: String(n.id), name: String(n.name) }));
              }
            } catch { /* best effort */ }
          } else {
            // phase: fetch from phases API filtered by entity type
            try {
              const pRes = await fetch(`${apiBase()}/phases?fields=id,name&limit=50`, {
                headers: headers(token),
              });
              if (pRes.ok) {
                const pData = await pRes.json() as { data?: any[] };
                options = (pData.data ?? [])
                  .filter((p: any) => p.id?.startsWith(`phase.${entityType}.`))
                  .map((p: any) => ({ id: String(p.id), name: String(p.name) }));
              }
            } catch { /* best effort */ }
          }
          fields.push({ ...base, fieldType: 'list_node', options });
        } else if (targetType === 'phase') {
          // Phase dropdown — fetch phases for this entity type
          let options: import('./adapter.js').CreateFieldOption[] = [];
          try {
            const pRes = await fetch(`${apiBase()}/phases?fields=id,name&limit=50`, {
              headers: headers(token),
            });
            if (pRes.ok) {
              const pData = await pRes.json() as { data?: any[] };
              options = (pData.data ?? [])
                .filter((p: any) => p.id?.startsWith(`phase.${entityType}.`))
                .map((p: any) => ({ id: String(p.id), name: String(p.name) }));
            }
          } catch { /* best effort */ }
          fields.push({ ...base, fieldType: 'list_node', options });
        } else {
          // Non-inline reference (team, release, sprint, owner) — searchable
          fields.push({ ...base, searchEntityType: targetType, referenceType: targetType });
        }
      } else {
        // string, memo, integer, date, boolean
        fields.push(base);
      }
    }

    // Determine parent requirements
    const requiredParentType = PARENT_TYPE[entityType];
    const parentEntityType = (requiredParentType && requiredParentType !== 'work_item_root')
      ? requiredParentType
      : null;
    const parentEntityTypeLabel = parentEntityType
      ? (ENTITY_LABELS[parentEntityType] || parentEntityType)
      : null;

    return { entityType, parentEntityType, parentEntityTypeLabel, fields };
  }
}
