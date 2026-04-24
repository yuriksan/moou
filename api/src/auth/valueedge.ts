import { Router } from 'express';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSession } from './session.js';
import { configuredAdminIds } from './configured-admins.js';

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
    // emailUserId is our initial best guess — may be replaced by a numeric VE id below
    const emailUserId = `valueedge:${veUserName}`;
    let userId = emailUserId;
    let resolvedDisplayName = false;
    let resolvedVeId: string | undefined; // numeric/canonical id returned by workspace_users

    const veHeaders = { 'Cookie': `${cookieName}=${lwsso}`, 'HPECLIENTTYPE': 'HPE_REST_API_TECH_PREVIEW' };

    // Step 1: /v1/auth — confirms identity, sometimes returns a numeric id
    try {
      const meRes = await fetch(`${BASE_URL}/v1/auth`, { headers: veHeaders });
      const me = JSON.parse(await meRes.text()) as { id?: string; name?: string; full_name?: string; email?: string };
      console.log('[VE me] status=', meRes.status, 'body=', JSON.stringify(me));
      if (me.id || me.name) {
        const veId = me.id || me.name!;
        // Only treat as a canonical id if it's not just the login email again
        if (veId !== veUserName) resolvedVeId = veId;
        userId = `valueedge:${veId}`;
        if (me.full_name) {
          userName = me.full_name;
          initials = userName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || initials;
          resolvedDisplayName = true;
        }
      }
    } catch {
      // Non-fatal
    }

    // Step 2: workspace_users — reliable source for full_name AND canonical numeric id.
    // Configured admins are stored with email-based ids (e.g. valueedge:areid2@opentext.com)
    // because that's all we know at config time. workspace_users may return a numeric id
    // (e.g. 93022) which should become the canonical id — same as users added via directory search.
    try {
      const escaped = veUserName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const query = encodeURIComponent(`"name='${escaped}' || email='${escaped}'"`);
      const wsUsersUrl = `${BASE_URL}/api/shared_spaces/${SHARED_SPACE}/workspaces/${WORKSPACE}`
        + `/workspace_users?query=${query}&fields=id,full_name,first_name,last_name,email&limit=1`;
      const wuRes = await fetch(wsUsersUrl, { headers: veHeaders });
      console.log('[VE workspace_users] status=', wuRes.status);
      if (wuRes.ok) {
        const wuBody = await wuRes.json() as { data?: Array<{ id?: unknown; full_name?: string; first_name?: string; last_name?: string; email?: string }> };
        const wuUser = wuBody.data?.[0];
        console.log('[VE workspace_users] total=', wuBody.data?.length ?? 0, 'user=', wuUser ? JSON.stringify(wuUser) : 'none');
        if (wuUser) {
          // Use numeric id from workspace_users as canonical if it differs from login email
          const wuId = wuUser.id != null ? String(wuUser.id) : undefined;
          if (wuId && wuId !== veUserName) {
            resolvedVeId = wuId;
            userId = `valueedge:${wuId}`;
          }
          if (!resolvedDisplayName) {
            const fullName = wuUser.full_name
              || [wuUser.first_name, wuUser.last_name].filter(Boolean).join(' ');
            if (fullName) {
              userName = fullName;
              initials = userName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || initials;
              resolvedDisplayName = true;
            }
          }
        }
      }
    } catch {
      // Non-fatal
    }

    // Check if user exists under the resolved canonical id
    let existing = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];

    // If not found under canonical id, check if there's an email-based configured-admin stub.
    // This happens on first login for admins defined in ADMIN_USERS with their email.
    if (!existing && resolvedVeId && userId !== emailUserId) {
      const emailStub = (await db.select().from(users).where(eq(users.id, emailUserId)).limit(1))[0];
      if (emailStub) {
        console.log(`[VE auth] Migrating configured-admin stub ${emailUserId} → ${userId}`);
        try {
          await db.transaction(async (tx) => {
            await tx.insert(users).values({ ...emailStub, id: userId, providerId: resolvedVeId! });
            await tx.delete(users).where(eq(users.id, emailUserId));
          });
          // Keep configuredAdminIds in sync so the "Configured" tag shows correctly in admin UI
          configuredAdminIds.add(userId);
          configuredAdminIds.delete(emailUserId);
          existing = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
        } catch (migErr) {
          // Migration failed (e.g. FK deps) — fall back to email-based stub
          console.warn('[VE auth] Stub migration failed, falling back to email id:', migErr);
          userId = emailUserId;
          existing = emailStub;
        }
      }
    }

    if (!existing || existing.status === 'revoked') {
      res.status(403).json({ error: { code: 'ACCESS_DENIED', message: 'Your account has not been granted access. Ask an administrator to add you.' } });
      return;
    }

    // Update name/initials only when VE gave us a real display name; otherwise preserve admin-set value
    if (resolvedDisplayName) {
      await db.update(users).set({ name: userName, initials, avatarUrl: `/api/users/${userId}/avatar`, lastLoginAt: new Date() }).where(eq(users.id, userId));
    } else {
      userName = existing.name;
      initials = existing.initials;
      await db.update(users).set({ avatarUrl: `/api/users/${userId}/avatar`, lastLoginAt: new Date() }).where(eq(users.id, userId));
    }

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

