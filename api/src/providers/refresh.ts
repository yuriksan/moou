import { db } from '../db/index.js';
import { externalLinks } from '../db/schema.js';
import { eq, sql, and, isNotNull } from 'drizzle-orm';
import { getAdapter } from './registry.js';
import { ProviderAuthError } from './adapter.js';
import { getSession } from '../auth/session.js';

/**
 * Refresh cached details for a single external link.
 * Uses ETag conditional request to avoid rate limit waste.
 */
export async function refreshLink(linkId: string, token: string): Promise<boolean> {
  const adapter = getAdapter();
  if (!adapter) return false;

  const [link] = await db.select().from(externalLinks).where(eq(externalLinks.id, linkId)).limit(1);
  if (!link) return false;

  const cached = link.cachedDetails as Record<string, unknown> | null;
  const etag = cached?.etag as string | undefined;

  try {
    const result = await adapter.getItemDetails(token, link.entityType, link.entityId, etag);

    if (result === 'not-modified') {
      // Update fetchedAt only
      await db.update(externalLinks).set({
        cachedDetails: { ...cached, fetchedAt: new Date().toISOString() },
      }).where(eq(externalLinks.id, linkId));
      return false; // no change
    }

    // Fetch child progress if available
    const childProgress = await adapter.getChildProgress(token, result.item.entityType, link.entityId);

    // If the adapter resolved a more specific entity type (e.g. work_item → epic), persist it
    const resolvedEntityType = result.item.entityType !== link.entityType
      ? result.item.entityType
      : undefined;

    await db.update(externalLinks).set({
      ...(resolvedEntityType ? { entityType: resolvedEntityType } : {}),
      ...(result.item.htmlUrl ? { url: result.item.htmlUrl } : {}),
      cachedDetails: {
        ...result.item,
        childProgress,
        etag: result.etag,
        fetchedAt: new Date().toISOString(),
      },
    }).where(eq(externalLinks.id, linkId));

    return true; // changed
  } catch (err) {
    if (err instanceof ProviderAuthError) throw err; // callers must handle auth errors
    console.error(`Failed to refresh link ${linkId}:`, err);
    return false;
  }
}

/**
 * Refresh all stale external links (older than maxAgeMinutes).
 * Requires a system-level token — in GitHub mode, we use the first available session.
 * For background refresh, we need a stored token approach.
 */
export async function refreshStaleLinks(maxAgeMinutes: number = 15): Promise<number> {
  const adapter = getAdapter();
  if (!adapter) return 0;

  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

  // Find links with stale or missing cached details
  const staleLinks = await db.select({
    id: externalLinks.id,
    entityType: externalLinks.entityType,
    entityId: externalLinks.entityId,
    cachedDetails: externalLinks.cachedDetails,
  }).from(externalLinks)
    .where(
      sql`${externalLinks.cachedDetails} IS NULL OR (${externalLinks.cachedDetails}->>'fetchedAt')::timestamptz < ${cutoff}::timestamptz`
    )
    .limit(50); // batch limit to avoid rate limit issues

  // For background refresh, we need a token. This is a limitation —
  // background jobs don't have a user session. For now, skip background refresh
  // and rely on on-demand refresh when users view outcomes.
  // TODO: Store a service-level token for background refresh.
  console.log(`Found ${staleLinks.length} stale links (background refresh requires stored token — skipping)`);
  return staleLinks.length;
}
