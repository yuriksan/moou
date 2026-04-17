import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from './middleware/auth.js';
import { db } from './db/index.js';
import { motivationTypes } from './db/schema.js';
import tagsRouter from './routes/tags.js';
import milestonesRouter from './routes/milestones.js';
import outcomesRouter from './routes/outcomes.js';
import motivationsRouter from './routes/motivations.js';
import commentsRouter from './routes/comments.js';
import historyRouter from './routes/history.js';
import externalLinksRouter from './routes/external-links.js';
import scoringRouter from './routes/scoring.js';
import exportRouter from './routes/export.js';
import importRouter from './routes/import.js';
import searchRouter from './routes/search.js';
import backendRouter from './routes/backend.js';
import { sseHandler } from './sse/emitter.js';
import { getProvider } from './providers.js';
import { getSession } from './auth/session.js';
import githubAuthRouter from './auth/github.js';
import valueedgeAuthRouter from './auth/valueedge.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const app = express();

// ─── Rate limiting ───
// Skip in tests so the integration suite (which fires hundreds of requests
// from a single IP) doesn't trip the limiter. The skip predicate checks
// NODE_ENV and the VITEST env var on every request — evaluating it once
// at import time would be wrong because the test setup file may set
// NODE_ENV after this module has already loaded.
function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,                           // 100 requests per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTestEnv(),
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down.' } },
});

const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,                           // 300 mutations per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => isTestEnv() || req.method === 'GET',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many mutations, please slow down.' } },
});

const recalculateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 1,                             // 1 recalculation every 5 minutes per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => isTestEnv(),
  message: { error: { code: 'RATE_LIMITED', message: 'Recalculation can only be triggered once every 5 minutes.' } },
});

// ─── Middleware ───
// helmet sets a sensible bundle of security headers (CSP, X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy, etc). The default CSP is too
// strict for the SPA — Vue's runtime needs `'unsafe-inline'` styles, and
// the avatar URLs are loaded from githubusercontent.com — so we override
// just the directives that need it.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://avatars.githubusercontent.com', 'https://*.githubusercontent.com'],
      connectSrc: ["'self'", 'https://api.github.com'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  // Cross-Origin-Embedder-Policy off so the SPA can load the GitHub avatar
  // images without their server having to opt in to CORP.
  crossOriginEmbedderPolicy: false,
}));

app.use('/api/import/timeline/diff', express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
}));

// Global limiter applies to everything; mutation limiter is mounted on /api
// so all api routes share the tighter mutation budget.
app.use(globalLimiter);

// ─── Auth routes (before auth middleware — no auth required to login) ───
app.use('/auth', githubAuthRouter);
app.use('/auth', valueedgeAuthRouter);

// ─── /api/me endpoint (returns current user from session or mock) ───
app.get('/api/me', async (req, res) => {
  if (process.env.EXTERNAL_PROVIDER === 'github' || process.env.EXTERNAL_PROVIDER === 'valueedge') {
    const session = await getSession(req, res);
    if (session.user) {
      res.json(session.user);
      return;
    }
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    return;
  }
  // Mock mode — return user from header
  const userId = req.headers['x-user-id'];
  if (typeof userId === 'string') {
    const { db } = await import('./db/index.js');
    const { users } = await import('./db/schema.js');
    const { eq } = await import('drizzle-orm');
    const lookupId = userId.includes(':') ? userId : `mock:${userId}`;
    const [user] = await db.select().from(users).where(eq(users.id, lookupId)).limit(1);
    if (user) { res.json(user); return; }
  }
  res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
});

// ─── Health check (outside /api prefix for load balancers, no auth required) ───
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

// ─── Public info endpoint — returns the configured provider so the login
//     page can show the correct sign-in flow before auth is established. ───
app.get('/api/provider', (_req, res) => {
  res.json(getProvider());
});

// ─── Serve frontend static files (before auth — no session required) ───
const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDist = join(__dirname, '../../app/dist');

app.use(express.static(frontendDist));

// SPA fallback — any non-API GET serves index.html
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return next();
  res.sendFile(join(frontendDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.use(authMiddleware);


// ─── API routes — all under /api/ ───
const api = express.Router();

// Tighter limit for mutations (POST/PUT/PATCH/DELETE) — applied before any
// route that lives on the api router.
api.use(mutationLimiter);

// Very tight limit for the expensive scoring recalculation endpoint —
// mounted before the scoring router so it sees the request first.
api.use('/scoring/recalculate', recalculateLimiter);

api.use('/tags', tagsRouter);
api.use('/milestones', milestonesRouter);
api.use('/outcomes', outcomesRouter);
api.use('/motivations', motivationsRouter);
api.use('/outcomes', commentsRouter);
api.use('/', historyRouter);
api.use('/external-links', externalLinksRouter);
api.use('/scoring', scoringRouter);
api.use('/', scoringRouter); // GET /api/outcomes/:id/score
api.get('/events', sseHandler);
api.use('/search', searchRouter);
api.use('/backend', backendRouter);
api.use('/outcomes', backendRouter); // POST /api/outcomes/:id/connect and /publish
api.use('/external-links', backendRouter); // POST /api/external-links/:linkId/refresh
api.use('/export', exportRouter);
api.use('/import', importRouter);

api.get('/motivation-types', async (_req, res) => {
  const types = await db.select().from(motivationTypes);
  res.json(types);
});

app.use('/api', api);

// ─── Global error handler ───
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
});
