import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSession } from '../auth/session.js';

const isGitHubProvider = process.env.EXTERNAL_PROVIDER === 'github';

// Extend Express Request to include user and accessToken
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        role: string | null;
        initials: string;
        avatarUrl?: string | null;
      };
      accessToken?: string;
    }
  }
}

/**
 * Dual-mode auth middleware:
 * - GitHub provider: reads user from iron-session cookie
 * - Mock/other provider: reads X-User-Id header (dev mode)
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (isGitHubProvider) {
    return githubAuth(req, res, next);
  }
  return mockAuth(req, res, next);
}

// ─── GitHub OAuth cookie auth ───
async function githubAuth(req: Request, res: Response, next: NextFunction) {
  const session = await getSession(req, res);

  if (session.user && session.accessToken) {
    req.user = session.user as any;
    req.accessToken = session.accessToken;
    return next();
  }

  // GET requests proceed without auth (shareable URLs)
  if (req.method === 'GET') {
    return next();
  }

  // Mutations require auth
  res.status(401).json({
    error: { code: 'UNAUTHORIZED', message: 'Not authenticated. Sign in via GitHub.' },
  });
}

// ─── Mock header auth (dev mode) ───
async function mockAuth(req: Request, res: Response, next: NextFunction) {
  // GET requests bypass auth (shareable URLs)
  if (req.method === 'GET') {
    const userId = req.headers['x-user-id'];
    if (typeof userId === 'string' && userId.length > 0) {
      // Support both old format (sarah-chen) and new format (mock:sarah-chen)
      const lookupId = userId.includes(':') ? userId : `mock:${userId}`;
      const [user] = await db.select().from(users).where(eq(users.id, lookupId)).limit(1);
      if (user) {
        req.user = user as any;
        req.accessToken = 'mock-token';
      }
    }
    return next();
  }

  // All mutations require auth. We deliberately use the same generic
  // "Authentication failed" message for both "no credentials" and "wrong
  // credentials" so an attacker can't distinguish the two cases and probe
  // for valid user ids.
  const userId = req.headers['x-user-id'];
  if (typeof userId !== 'string' || userId.length === 0) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication failed' },
    });
    return;
  }

  const lookupId = userId.includes(':') ? userId : `mock:${userId}`;
  const [user] = await db.select().from(users).where(eq(users.id, lookupId)).limit(1);
  if (!user) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication failed' },
    });
    return;
  }

  req.user = user as any;
  // In mock mode, set a dummy access token so backend adapter routes work in tests
  req.accessToken = 'mock-token';
  next();
}
