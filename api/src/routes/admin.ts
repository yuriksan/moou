import { Router } from 'express';
import { db } from '../db/index.js';
import { users, userAuditLog } from '../db/schema.js';
import { eq, and, or, ilike, sql, desc } from 'drizzle-orm';
import { requireAdmin } from '../middleware/authorize.js';
import { configuredAdminIds } from '../auth/configured-admins.js';
import { getAdapter } from '../providers/registry.js';
import { ProviderAuthError } from '../providers/adapter.js';
import rateLimit from 'express-rate-limit';

const router = Router();

// All admin routes require admin role
router.use(requireAdmin);

// ─── GET /api/admin/users ───
// Paginated list with optional filters: q, role, status, cursor, limit
router.get('/users', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const cursor = req.query.cursor as string | undefined;
  const q = req.query.q as string | undefined;
  const roleFilter = req.query.role as string | undefined;
  const statusFilter = req.query.status as string | undefined;

  const conditions = [];
  if (q) {
    conditions.push(or(
      ilike(users.name, `%${q}%`),
      ilike(users.email, `%${q}%`),
      ilike(users.providerId, `%${q}%`),
    ));
  }
  if (roleFilter) conditions.push(eq(users.role, roleFilter));
  if (statusFilter) conditions.push(eq(users.status, statusFilter));
  if (cursor) conditions.push(sql`${users.id} > ${cursor}`);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select().from(users)
    .where(where)
    .orderBy(users.id)
    .limit(limit + 1); // fetch one extra to detect next page

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? data[data.length - 1].id : undefined;

  // Tag configured admins
  const result = data.map(u => ({
    ...u,
    isConfiguredAdmin: configuredAdminIds.has(u.id),
  }));

  res.json({ data: result, nextCursor });
});

// ─── POST /api/admin/users ───
// Create a user from a provider directory search result
router.post('/users', async (req, res) => {
  const { providerId, name, email, avatarUrl, role } = req.body;

  if (!providerId || !name) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'providerId and name are required' } });
    return;
  }

  const validRoles = ['admin', 'modifier', 'viewer'];
  const userRole = validRoles.includes(role) ? role : 'modifier';

  const provider = process.env.EXTERNAL_PROVIDER || 'mock';
  const userId = `${provider}:${providerId}`;

  // Check if already exists
  const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (existing) {
    res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: 'User already exists' } });
    return;
  }

  const initials = name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || '??';

  const [created] = await db.insert(users).values({
    id: userId,
    provider,
    providerId,
    name,
    email: email || null,
    avatarUrl: avatarUrl || null,
    role: userRole,
    status: 'active',
    initials,
    createdBy: req.user!.id,
  }).returning();

  // Audit log
  await db.insert(userAuditLog).values({
    targetUserId: userId,
    actorUserId: req.user!.id,
    action: 'granted',
    toRole: userRole,
  });

  res.status(201).json({ ...created, isConfiguredAdmin: false });
});

// ─── PATCH /api/admin/users/:id ───
// Change role
router.patch('/users/:id', async (req, res) => {
  const targetId = req.params.id;
  const { role } = req.body;

  const validRoles = ['admin', 'modifier', 'viewer'];
  if (!validRoles.includes(role)) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `role must be one of: ${validRoles.join(', ')}` } });
    return;
  }

  // Guard: cannot modify self
  if (targetId === req.user!.id) {
    res.status(409).json({ error: { code: 'CANNOT_MODIFY_SELF', message: 'Admins cannot change their own role.' } });
    return;
  }

  // Guard: configured admins are immutable
  if (configuredAdminIds.has(targetId)) {
    res.status(409).json({ error: { code: 'CONFIGURED_ADMIN_IMMUTABLE', message: 'This user is configured via ADMIN_USERS and cannot be changed from the UI.' } });
    return;
  }

  const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    return;
  }

  const oldRole = target.role;
  const [updated] = await db.update(users)
    .set({ role })
    .where(eq(users.id, targetId))
    .returning();

  await db.insert(userAuditLog).values({
    targetUserId: targetId,
    actorUserId: req.user!.id,
    action: 'role_changed',
    fromRole: oldRole,
    toRole: role,
  });

  res.json({ ...updated, isConfiguredAdmin: false });
});

// ─── POST /api/admin/users/:id/revoke ───
router.post('/users/:id/revoke', async (req, res) => {
  const targetId = req.params.id;

  if (targetId === req.user!.id) {
    res.status(409).json({ error: { code: 'CANNOT_MODIFY_SELF', message: 'Admins cannot revoke themselves.' } });
    return;
  }

  if (configuredAdminIds.has(targetId)) {
    res.status(409).json({ error: { code: 'CONFIGURED_ADMIN_IMMUTABLE', message: 'This user is configured via ADMIN_USERS and cannot be changed from the UI.' } });
    return;
  }

  const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    return;
  }

  const [updated] = await db.update(users)
    .set({ status: 'revoked' })
    .where(eq(users.id, targetId))
    .returning();

  await db.insert(userAuditLog).values({
    targetUserId: targetId,
    actorUserId: req.user!.id,
    action: 'revoked',
    fromRole: target.role,
  });

  res.json({ ...updated, isConfiguredAdmin: false });
});

// ─── POST /api/admin/users/:id/restore ───
router.post('/users/:id/restore', async (req, res) => {
  const targetId = req.params.id;

  if (configuredAdminIds.has(targetId)) {
    res.status(409).json({ error: { code: 'CONFIGURED_ADMIN_IMMUTABLE', message: 'This user is configured via ADMIN_USERS and cannot be changed from the UI.' } });
    return;
  }

  const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    return;
  }

  const [updated] = await db.update(users)
    .set({ status: 'active' })
    .where(eq(users.id, targetId))
    .returning();

  await db.insert(userAuditLog).values({
    targetUserId: targetId,
    actorUserId: req.user!.id,
    action: 'restored',
    toRole: target.role,
  });

  res.json({ ...updated, isConfiguredAdmin: false });
});

// ─── GET /api/admin/users/:id/audit ───
router.get('/users/:id/audit', async (req, res) => {
  const rows = await db.select().from(userAuditLog)
    .where(eq(userAuditLog.targetUserId, req.params.id))
    .orderBy(desc(userAuditLog.at))
    .limit(100);

  res.json(rows);
});

// ─── GET /api/admin/directory ───
// Search the active provider's user directory
const directoryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many directory searches. Please slow down.' } },
});

router.get('/directory', directoryLimiter, async (req, res) => {
  const adapter = getAdapter();
  if (!adapter?.searchDirectory) {
    res.status(400).json({ error: { code: 'NOT_SUPPORTED', message: 'Provider does not support directory search' } });
    return;
  }

  const token = req.accessToken;
  if (!token) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const q = (req.query.q as string) || '';
  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 20, 50);

  try {
    const result = await adapter.searchDirectory(token, q, { cursor, limit });
    res.json(result);
  } catch (err: any) {
    if (err instanceof ProviderAuthError) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: err.message } });
      return;
    }
    res.status(502).json({ error: { code: 'BACKEND_ERROR', message: err.message || 'Directory search failed' } });
  }
});

export default router;
