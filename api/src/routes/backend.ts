import { Router } from 'express';
import { db } from '../db/index.js';
import { externalLinks, outcomes, backendFieldConfig } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { getAdapter } from '../providers/adapter.js';
import { refreshLink } from '../providers/refresh.js';
import { recordHistory } from '../lib/history.js';
import { broadcast } from '../sse/emitter.js';

const router = Router();

// GET /api/backend/search?q=term&type=issue
// Proxies search to the configured provider adapter
router.get('/search', async (req, res) => {
  const adapter = getAdapter();
  if (!adapter) {
    res.status(400).json({ error: { code: 'NO_ADAPTER', message: 'No backend adapter configured for this provider' } });
    return;
  }

  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ items: [] });
    return;
  }

  const token = req.accessToken;
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required to search backend' } });
    return;
  }

  const entityType = req.query.type as string | undefined;

  try {
    const items = await adapter.searchItems(token, q, entityType);
    res.json({ items, provider: adapter.name, entityTypes: adapter.entityTypes });
  } catch (err: any) {
    console.error('Backend search failed:', err);
    res.status(502).json({ error: { code: 'BACKEND_ERROR', message: err.message || 'Backend search failed' } });
  }
});

// GET /api/backend/create-options?entityType=story
// Returns field descriptors (required fields + key optional) with pre-fetched allowed values
router.get('/create-options', async (req, res) => {
  const adapter = getAdapter();
  if (!adapter || !adapter.getCreateOptions) {
    res.json({ fields: [], parentEntityType: null, parentEntityTypeLabel: null });
    return;
  }

  const entityType = String(req.query.entityType || '');
  if (!entityType) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'entityType is required' } });
    return;
  }

  const token = req.accessToken;
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  try {
    const options = await adapter.getCreateOptions(token, entityType);
    if (!options) {
      res.json({ fields: [], parentEntityType: null, parentEntityTypeLabel: null });
      return;
    }
    // Merge DB field-config overrides: override `required` for existing fields,
    // and append any config rows whose fieldName isn't in the metadata response.
    const configs = await db.select().from(backendFieldConfig).where(
      and(eq(backendFieldConfig.provider, adapter.name), eq(backendFieldConfig.entityType, entityType))
    );
    if (configs.length) {
      const configMap = new Map(configs.map(c => [c.fieldName, c.required]));
      const seen = new Set<string>();
      const merged = options.fields.map(f => {
        seen.add(f.name);
        return configMap.has(f.name) ? { ...f, required: configMap.get(f.name)! } : f;
      });
      for (const c of configs) {
        if (!seen.has(c.fieldName)) {
          merged.push({ name: c.fieldName, label: c.fieldName, fieldType: 'string' as const, required: c.required });
        }
      }
      res.json({ ...options, fields: merged });
    } else {
      res.json(options);
    }
  } catch (err: any) {
    console.error('getCreateOptions failed:', err);
    res.status(502).json({ error: { code: 'BACKEND_ERROR', message: err.message } });
  }
});

// GET /api/backend/entity-types
// Returns the available entity types for the configured provider
router.get('/entity-types', (_req, res) => {
  const adapter = getAdapter();
  if (!adapter) {
    res.json({ entityTypes: [], provider: null });
    return;
  }
  res.json({ entityTypes: adapter.entityTypes, provider: adapter.name, label: adapter.label });
});

// POST /api/outcomes/:id/connect
// Connect an outcome to an existing backend item
router.post('/:id/connect', async (req, res) => {
  const adapter = getAdapter();
  if (!adapter) {
    res.status(400).json({ error: { code: 'NO_ADAPTER', message: 'No backend adapter configured' } });
    return;
  }

  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!outcome) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  const { entityType, entityId } = req.body;
  if (!entityType || !entityId) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'entityType and entityId are required' } });
    return;
  }

  const token = req.accessToken;
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  // Validate item exists in the backend
  try {
    const result = await adapter.getItemDetails(token, entityType, entityId);
    if (result === 'not-modified') {
      res.status(500).json({ error: { code: 'UNEXPECTED', message: 'Unexpected 304 on first fetch' } });
      return;
    }

    // Fetch child progress if available
    const childProgress = await adapter.getChildProgress(token, entityType, entityId);

    // Create the external link with cached details
    const [link] = await db.insert(externalLinks).values({
      outcomeId: outcome.id,
      provider: adapter.name,
      entityType,
      entityId: String(entityId),
      url: result.item.htmlUrl,
      connectionState: 'connected',
      cachedDetails: {
        ...result.item,
        childProgress,
        etag: result.etag,
        fetchedAt: new Date().toISOString(),
      },
      createdBy: req.user!.id,
    }).returning() as any[];

    await recordHistory('external_link', link.id, 'created', {
      provider: { old: null, new: adapter.name },
      entityType: { old: null, new: entityType },
      entityId: { old: null, new: entityId },
      connectionState: { old: null, new: 'connected' },
    }, req.user!.id);

    broadcast({ type: 'external_link_created', id: link.id, outcomeId: outcome.id });
    res.status(201).json(link);
  } catch (err: any) {
    if (err.message?.includes('404') || err.message?.includes('not found')) {
      res.status(400).json({ error: { code: 'NOT_FOUND', message: `${entityType} #${entityId} not found in ${adapter.label}` } });
      return;
    }
    console.error('Connect failed:', err);
    res.status(502).json({ error: { code: 'BACKEND_ERROR', message: err.message || 'Failed to fetch item from backend' } });
  }
});

// POST /api/outcomes/:id/publish
// Create a new item in the backend from the outcome
router.post('/:id/publish', async (req, res) => {
  const adapter = getAdapter();
  if (!adapter) {
    res.status(400).json({ error: { code: 'NO_ADAPTER', message: 'No backend adapter configured' } });
    return;
  }

  const [outcome] = await db.select().from(outcomes).where(eq(outcomes.id, req.params.id)).limit(1);
  if (!outcome) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Outcome not found' } });
    return;
  }

  const token = req.accessToken;
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const entityType = req.body.entityType || adapter.entityTypes.find(t => t.default)?.name || adapter.entityTypes[0]?.name;
  if (!entityType) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No entity type available' } });
    return;
  }

  const parentEntityId: string | undefined = req.body.parentEntityId || undefined;
  const parentEntityType: string | undefined = req.body.parentEntityType || undefined;

  // Any extra fields beyond the standard ones (phase override, team, release, sprint, priority, story_points, etc.)
  const STANDARD_KEYS = new Set(['entityType', 'parentEntityId', 'parentEntityType']);
  const extraFields: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!STANDARD_KEYS.has(k)) extraFields[k] = v;
  }

  try {
    const created = await adapter.createItem(
      token,
      entityType,
      outcome.title,
      outcome.description || undefined,
      parentEntityId
        ? { parentEntityId, parentEntityType, ...extraFields }
        : Object.keys(extraFields).length ? extraFields : undefined,
    );

    // Fetch full details of the newly created item
    const details = await adapter.getItemDetails(token, entityType, created.entityId);
    const childProgress = await adapter.getChildProgress(token, entityType, created.entityId);

    const cachedDetails = details !== 'not-modified' ? {
      ...details.item,
      childProgress,
      etag: details.etag,
      fetchedAt: new Date().toISOString(),
    } : undefined;

    const [link] = await db.insert(externalLinks).values({
      outcomeId: outcome.id,
      provider: adapter.name,
      entityType,
      entityId: created.entityId,
      url: created.url,
      connectionState: 'published',
      cachedDetails,
      createdBy: req.user!.id,
    }).returning() as any[];

    await recordHistory('external_link', link.id, 'created', {
      provider: { old: null, new: adapter.name },
      entityType: { old: null, new: entityType },
      entityId: { old: null, new: created.entityId },
      connectionState: { old: null, new: 'published' },
    }, req.user!.id);

    broadcast({ type: 'external_link_created', id: link.id, outcomeId: outcome.id });
    res.status(201).json(link);
  } catch (err: any) {
    console.error('Publish failed:', err);
    res.status(502).json({ error: { code: 'BACKEND_ERROR', message: err.message || 'Failed to create item in backend' } });
  }
});

// GET /api/backend/field-config?provider=X&entityType=Y
// Returns all config rows for the given provider + entity type. Admin-only.
router.get('/field-config', async (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    return;
  }
  const provider = String(req.query.provider || '').trim();
  const entityType = String(req.query.entityType || '').trim();
  if (!provider || !entityType) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'provider and entityType are required' } });
    return;
  }
  const rows = await db.select().from(backendFieldConfig).where(
    and(eq(backendFieldConfig.provider, provider), eq(backendFieldConfig.entityType, entityType))
  );
  res.json({ data: rows });
});

// PUT /api/backend/field-config
// Upsert a config row. Admin-only.
router.put('/field-config', async (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    return;
  }
  const { provider, entityType, fieldName, required } = req.body || {};
  if (!provider || !entityType || !fieldName || typeof required !== 'boolean') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'provider, entityType, fieldName, and required (boolean) are required' } });
    return;
  }
  const [row] = await db.insert(backendFieldConfig)
    .values({ provider, entityType, fieldName, required })
    .onConflictDoUpdate({
      target: [backendFieldConfig.provider, backendFieldConfig.entityType, backendFieldConfig.fieldName],
      set: { required, updatedAt: new Date() },
    })
    .returning();
  res.json(row);
});

// DELETE /api/backend/field-config/:id
// Remove a config row. Admin-only.
router.delete('/field-config/:id', async (req, res) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } });
    return;
  }
  await db.delete(backendFieldConfig).where(eq(backendFieldConfig.id, req.params.id));
  res.status(204).end();
});

// POST /api/external-links/:id/refresh
// Manually refresh cached details for a single link
router.post('/:linkId/refresh', async (req, res) => {
  const token = req.accessToken;
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  try {
    const changed = await refreshLink(req.params.linkId, token);
    const [link] = await db.select().from(externalLinks).where(eq(externalLinks.id, req.params.linkId)).limit(1);
    res.json({ changed, link });
  } catch (err: any) {
    res.status(502).json({ error: { code: 'BACKEND_ERROR', message: err.message || 'Refresh failed' } });
  }
});

export default router;
