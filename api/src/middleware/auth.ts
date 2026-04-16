import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSession } from '../auth/session.js';

const isGitHubProvider = process.env.EXTERNAL_PROVIDER === 'github';
const isValueEdgeProvider = process.env.EXTERNAL_PROVIDER === 'valueedge';
const isTestEnv = () => process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

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
 * Auth middleware.
 * - Tests: mockAuth via X-User-Id header (never reaches production)
 * - github: iron-session cookie from GitHub OAuth
 * - valueedge: iron-session cookie from ValueEdge Interactive Token Sharing
 * - anything else: misconfiguration — reject with 500
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (isTestEnv()) return mockAuth(req, res, next);
  if (isGitHubProvider) return githubAuth(req, res, next);
  if (isValueEdgeProvider) return sessionAuth(req, res, next);
  // No provider configured — should have been caught at startup
  res.status(500).json({ error: { code: 'MISCONFIGURED', message: 'No auth provider configured. Set EXTERNAL_PROVIDER.' } });
}

// ─── GitHub OAuth cookie auth ───
async function githubAuth(req: Request, res: Response, next: NextFunction) {
  const session = await getSession(req, res);

  if (session.user && session.accessToken) {
    req.user = session.user as any;
    req.accessToken = session.accessToken;
    return next();
  }

  res.status(401).json({
    error: { code: 'UNAUTHORIZED', message: 'Not authenticated. Sign in via GitHub.' },
  });
}

// ─── ValueEdge session-cookie auth ───
async function sessionAuth(req: Request, res: Response, next: NextFunction) {
  const session = await getSession(req, res);

  if (session.user && session.accessToken) {
    req.user = session.user as any;
    req.accessToken = session.accessToken;
    return next();
  }

  res.status(401).json({
    error: { code: 'UNAUTHORIZED', message: 'Not authenticated. Sign in via ValueEdge.' },
  });
}

// ─── Test-only mock auth (X-User-Id header, never used in production) ───
// We deliberately use the same generic "Authentication failed" message for
// both "no credentials" and "wrong credentials" so test failures are clear.
async function mockAuth(req: Request, res: Response, next: NextFunction) {
  const userId = req.headers['x-user-id'];
  if (typeof userId !== 'string' || userId.length === 0) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication failed' },
    });
    return;
  }

  // Support both old format (sarah-chen) and new format (mock:sarah-chen)
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
