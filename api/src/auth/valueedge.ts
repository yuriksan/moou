import { Router } from 'express';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSession } from './session.js';

const router = Router();

const BASE_URL = (process.env.VALUEEDGE_BASE_URL || 'https://ot-internal.saas.microfocus.com').replace(/\/$/, '');
const SHARED_SPACE = process.env.VALUEEDGE_SHARED_SPACE || '4001';
const WORKSPACE = process.env.VALUEEDGE_WORKSPACE || '48001';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 3 * 60 * 1000; // 3-minute handshake window

/**
 * POST /auth/valueedge/start
 *
 * Step 1 of the Interactive Token Sharing flow.
 * Requests a handshake identifier from ValueEdge and returns the
 * authentication URL for the frontend to open in a popup/tab.
 */
router.post('/valueedge/start', async (req, res) => {
  try {
    const tokenRes = await fetch(`${BASE_URL}/authentication/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (!tokenRes.ok) {
      res.status(502).json({ error: { code: 'BACKEND_ERROR', message: 'Failed to initiate ValueEdge authentication handshake' } });
      return;
    }

    const tokenData = await tokenRes.json() as { id?: string; authentication_url?: string };
    if (!tokenData.id || !tokenData.authentication_url) {
      res.status(502).json({ error: { code: 'BACKEND_ERROR', message: 'Unexpected response from ValueEdge authentication endpoint' } });
      return;
    }

    // Extract TENANTID from the authentication_url so we can pass it on poll requests
    const tenantId = new URL(tokenData.authentication_url).searchParams.get('TENANTID') ?? '1';

    // Return the handshake ID to the frontend — it sends it back on each poll
    // request. The ID is not a secret (it is embedded in the authentication_url)
    // and only valid for 3 minutes.
    res.json({ authUrl: tokenData.authentication_url, handshakeId: tokenData.id, tenantId });
  } catch (err) {
    console.error('ValueEdge auth start error:', err);
    res.status(502).json({ error: { code: 'BACKEND_ERROR', message: 'Failed to contact ValueEdge' } });
  }
});

/**
 * GET /auth/valueedge/poll
 *
 * Steps 2-3 of the Interactive Token Sharing flow.
 * Polls ValueEdge for the LWSSO_COOKIE_KEY using the handshake ID stored in session.
 * Returns { status: 'pending' } while waiting, { status: 'ok' } on success.
 *
 * The frontend should call this repeatedly (every ~3 seconds) after opening
 * the auth URL in a popup until it receives { status: 'ok' } or an error.
 */
router.get('/valueedge/poll', async (req, res) => {
  const handshakeId = req.query.handshakeId as string | undefined;
  const tenantId = (req.query.tenantId as string | undefined) ?? '1';
  const veUserName = req.query.userName as string | undefined;

  if (!handshakeId || !veUserName) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Missing handshakeId or userName query parameter.' } });
    return;
  }

  try {
    const pollUrl = `${BASE_URL}/authentication/tokens/${encodeURIComponent(handshakeId)}?TENANTID=${encodeURIComponent(tenantId)}&userName=${encodeURIComponent(veUserName)}`;
    const tokenRes = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'HPECLIENTTYPE': 'HPE_REST_API_TECH_PREVIEW',
      },
    });

    const pollBody = await tokenRes.text();

    if (tokenRes.status === 401 || tokenRes.status === 404) {
      res.json({ status: 'pending' });
      return;
    }

    if (!tokenRes.ok) {
      if (tokenRes.status === 410) {
        res.status(410).json({ error: { code: 'AUTH_EXPIRED', message: 'Authentication session expired. Please start again.' } });
        return;
      }
      res.status(502).json({ error: { code: 'BACKEND_ERROR', message: `ValueEdge returned ${tokenRes.status} while polling for token` } });
      return;
    }

    let tokenData: Record<string, unknown> = {};
    try { tokenData = JSON.parse(pollBody); } catch { /* ignore */ }

    // Response shape: { access_token, id, cookie_name } per VE docs
    const accessToken = tokenData.access_token as string | undefined;
    const cookieName = (tokenData.cookie_name as string | undefined) ?? 'LWSSO_COOKIE_KEY';

    if (!accessToken) {
      res.json({ status: 'pending' });
      return;
    }

    const lwsso = accessToken;

    // ── Workspace access check ───────────────────────────────────────────────
    // Verify the user can reach the configured workspace before committing any
    // session state. If not, discard the token and return a clear error — the
    // session cookie is never set.
    try {
      const wsUrl = `${BASE_URL}/api/shared_spaces/${SHARED_SPACE}/workspaces/${WORKSPACE}?fields=id,name`;
      const wsRes = await fetch(wsUrl, {
        headers: {
          'Cookie': `${cookieName}=${lwsso}`,
          'HPECLIENTTYPE': 'HPE_REST_API_TECH_PREVIEW',
        },
      });
      if (wsRes.status === 401 || wsRes.status === 403) {
        res.status(403).json({ error: { code: 'WORKSPACE_ACCESS_DENIED', message: 'Your account does not have access to the configured workspace. Contact your ValueEdge administrator.' } });
        return;
      }
      if (wsRes.status === 404) {
        res.status(400).json({ error: { code: 'WORKSPACE_NOT_FOUND', message: 'The configured ValueEdge workspace was not found — this is a server misconfiguration. Contact your administrator.' } });
        return;
      }
      if (!wsRes.ok) {
        res.status(502).json({ error: { code: 'BACKEND_ERROR', message: `ValueEdge returned ${wsRes.status} while verifying workspace access` } });
        return;
      }
    } catch (wsErr) {
      console.error('Workspace access check failed:', wsErr);
      res.status(502).json({ error: { code: 'BACKEND_ERROR', message: 'Failed to verify workspace access' } });
      return;
    }

    // Default to the login username — better than "ValueEdge User"
    let userName = veUserName;
    let initials = (veUserName.split('@')[0] ?? veUserName).slice(0, 2).toUpperCase();
    let userId = `valueedge:${veUserName}`;

    try {
      const meRes = await fetch(
        `${BASE_URL}/v1/auth`,
        { headers: { 'Cookie': `${cookieName}=${lwsso}`, 'HPECLIENTTYPE': 'HPE_REST_API_TECH_PREVIEW' } },
      );
      const meBody = await meRes.text();
      console.log('[VE me] status=', meRes.status);
      const me = JSON.parse(meBody) as { id?: string; name?: string; full_name?: string; email?: string };
      if (me.name || me.id) {
        userId = `valueedge:${me.id || me.name}`;
        userName = me.full_name || me.name || userName;
        initials = userName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || initials;
      }
    } catch {
      // Non-fatal; user info is best-effort
    }

    // Check if user exists and is allowed to log in (no auto-creation)
    const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!existing || existing.status === 'revoked') {
      // User not in DB or revoked — deny login
      res.status(403).json({ error: { code: 'ACCESS_DENIED', message: 'Your account has not been granted access. Ask an administrator to add you.' } });
      return;
    }

    // Update profile fields from VE (name, initials, lastLoginAt)
    await db.update(users).set({ name: userName, initials, lastLoginAt: new Date() }).where(eq(users.id, userId));

    // Persist the access token + user identity in the iron-session cookie
    const session = await getSession(req, res);
    session.accessToken = lwsso;
    session.user = { id: userId, provider: 'valueedge', providerId: userId, name: userName, initials };
    await session.save();

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('ValueEdge auth poll error:', err);
    res.status(502).json({ error: { code: 'BACKEND_ERROR', message: 'Failed to contact ValueEdge' } });
  }
});

/** POST /auth/valueedge/logout — Destroy the session */
router.post('/valueedge/logout', async (req, res) => {
  const session = await getSession(req, res);
  session.destroy();
  res.json({ ok: true });
});

export default router;

