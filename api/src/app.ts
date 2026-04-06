import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const app = express();

// ─── Middleware ───
app.use('/api/import/timeline/diff', express.raw({ type: '*/*', limit: '10mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
}));

// ─── Auth routes (before auth middleware — no auth required to login) ───
app.use('/auth', githubAuthRouter);

// ─── /api/me endpoint (returns current user from session or mock) ───
app.get('/api/me', async (req, res) => {
  if (process.env.EXTERNAL_PROVIDER === 'github') {
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

app.use(authMiddleware);

// ─── Health check (outside /api prefix for load balancers) ───
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

// ─── API routes — all under /api/ ───
const api = express.Router();

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

api.get('/provider', (_req, res) => {
  res.json(getProvider());
});

app.use('/api', api);

// ─── Serve frontend static files ───
const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDist = join(__dirname, '../../app/dist');

app.use(express.static(frontendDist));

// SPA fallback — any non-API GET serves index.html
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(join(frontendDist, 'index.html'), (err) => {
    if (err) next();
  });
});

// ─── Global error handler ───
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
});
