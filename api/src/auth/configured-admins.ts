import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/** Set of user IDs (provider:providerId) configured as admins via ADMIN_USERS env var. */
export const configuredAdminIds = new Set<string>();

/**
 * Parse ADMIN_USERS, upsert admin stubs, populate configuredAdminIds.
 * Called once at startup before the server listens.
 *
 * Format: comma-separated `<provider>:<providerId>` tokens.
 * Only tokens matching the active EXTERNAL_PROVIDER are accepted.
 * In mock mode, this step is skipped entirely (mock seeds its own users).
 */
export async function reconcileConfiguredAdmins(): Promise<void> {
  const provider = process.env.EXTERNAL_PROVIDER || 'mock';

  // Mock mode — skip bootstrap (seed.ts handles mock users)
  if (provider === 'mock') return;

  const raw = process.env.ADMIN_USERS || '';
  const tokens = raw.split(',').map(s => s.trim()).filter(Boolean);

  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx <= 0) {
      console.warn(`[admin-bootstrap] Ignoring malformed ADMIN_USERS token: "${token}" (expected provider:id)`);
      continue;
    }

    const tokenProvider = token.slice(0, colonIdx);
    const providerId = token.slice(colonIdx + 1);

    if (tokenProvider !== provider) {
      console.warn(`[admin-bootstrap] Ignoring ADMIN_USERS token "${token}" — provider "${tokenProvider}" does not match active provider "${provider}"`);
      continue;
    }

    const userId = `${tokenProvider}:${providerId}`;
    configuredAdminIds.add(userId);

    // Upsert: create stub if missing, promote to admin if exists
    const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (existing) {
      if (existing.role !== 'admin' || existing.status !== 'active') {
        await db.update(users)
          .set({ role: 'admin', status: 'active' })
          .where(eq(users.id, userId));
        console.log(`[admin-bootstrap] Promoted existing user "${userId}" to admin`);
      }
    } else {
      await db.insert(users).values({
        id: userId,
        provider: tokenProvider,
        providerId,
        name: providerId, // placeholder — real name fills in on first login
        role: 'admin',
        status: 'active',
        initials: '??',
      });
      console.log(`[admin-bootstrap] Created admin stub for "${userId}"`);
    }
  }

  if (configuredAdminIds.size === 0) {
    console.error(`[admin-bootstrap] FATAL: ADMIN_USERS contains no valid entries for provider "${provider}". Set ADMIN_USERS=<provider>:<id> and restart.`);
    process.exit(1);
  }

  console.log(`[admin-bootstrap] ${configuredAdminIds.size} configured admin(s): ${[...configuredAdminIds].join(', ')}`);
}
