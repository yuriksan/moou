import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSession } from './session.js';

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const GITHUB_CALLBACK_URL = process.env.GITHUB_CALLBACK_URL || 'http://localhost:3000/auth/callback';

// GET /auth/github — Redirect to GitHub OAuth
router.get('/github', async (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');

  // Store state in session for CSRF validation
  const session = await getSession(req, res);
  (session as any).oauthState = state;
  await session.save();

  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_CALLBACK_URL,
    scope: 'repo read:user user:email',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GET /auth/callback — Exchange code for token, create session
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code || typeof code !== 'string') {
    res.status(400).send('Missing authorization code');
    return;
  }

  // Validate CSRF state
  const session = await getSession(req, res);
  const expectedState = (session as any).oauthState;
  if (!state || state !== expectedState) {
    res.status(403).send('Invalid state parameter (CSRF check failed)');
    return;
  }
  delete (session as any).oauthState;

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: GITHUB_CALLBACK_URL,
    }),
  });

  const tokenData = await tokenRes.json() as { access_token?: string; error?: string; error_description?: string };
  if (!tokenData.access_token) {
    res.status(400).send(`GitHub OAuth error: ${tokenData.error_description || tokenData.error || 'unknown'}`);
    return;
  }

  // Fetch GitHub user profile
  const profileRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (!profileRes.ok) {
    res.status(502).send('Failed to fetch GitHub user profile');
    return;
  }

  const profile = await profileRes.json() as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
  };

  // Upsert user in database
  const userId = `github:${profile.id}`;
  const displayName = profile.name || profile.login;
  const initials = displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || profile.login.slice(0, 2).toUpperCase();

  const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (existing) {
    await db.update(users).set({
      name: displayName,
      avatarUrl: profile.avatar_url,
      initials,
    }).where(eq(users.id, userId));
  } else {
    await db.insert(users).values({
      id: userId,
      provider: 'github',
      providerId: String(profile.id),
      name: displayName,
      initials,
      avatarUrl: profile.avatar_url,
    });
  }

  // Create session
  session.accessToken = tokenData.access_token;
  session.user = {
    id: userId,
    provider: 'github',
    providerId: String(profile.id),
    name: displayName,
    initials,
    avatarUrl: profile.avatar_url,
  };
  await session.save();

  // Redirect to the app
  res.redirect('/');
});

// POST /auth/logout
router.post('/logout', async (req, res) => {
  const session = await getSession(req, res);
  session.destroy();
  res.json({ ok: true });
});

export default router;
