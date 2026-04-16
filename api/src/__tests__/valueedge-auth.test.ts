/**
 * Unit tests for the ValueEdge auth poll route, focused on the workspace
 * access check introduced to prevent silent broken sessions.
 *
 * We mount the router on a minimal Express app and mock:
 *   - fetch (global) — controls what VE API calls return
 *   - ../db/index.js — prevents any DB connection
 *   - ./session.js   — returns a no-op session so we can assert save() is not called
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Module mocks (must be declared before importing the router) ───────────

const mockSave = vi.fn();
const mockSession = { save: mockSave, accessToken: undefined as string | undefined, user: undefined as any };

vi.mock('../auth/session.js', () => ({
  getSession: vi.fn().mockResolvedValue(mockSession),
}));

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]), // no existing user — triggers insert path
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

// ─── Global fetch mock ─────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Set env vars before importing the router ─────────────────────────────

process.env.VALUEEDGE_BASE_URL = 'https://ot-internal.saas.microfocus.com';
process.env.VALUEEDGE_SHARED_SPACE = '4001';
process.env.VALUEEDGE_WORKSPACE = '48001';

// Lazy-import the router after mocks are in place
const { default: valueedgeAuthRouter } = await import('../auth/valueedge.js');

const app = express();
app.use(express.json());
app.use('/auth', valueedgeAuthRouter);

// ─── Helpers ──────────────────────────────────────────────────────────────

const POLL_URL = '/auth/valueedge/poll?handshakeId=abc123&tenantId=1&userName=alice%40example.com';

/** Build the sequence of fetch responses for a full successful poll flow */
function tokenResponse(accessToken = 'lwsso-token') {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ access_token: accessToken, cookie_name: 'LWSSO_COOKIE_KEY' }),
  };
}

/** Response for the /v1/auth "me" call */
const meResponse = {
  ok: true,
  status: 200,
  text: async () => JSON.stringify({ id: 'u1', name: 'alice', full_name: 'Alice Example' }),
  json: async () => ({ id: 'u1', name: 'alice', full_name: 'Alice Example' }),
};

/** Workspace probe response factory */
function workspaceResponse(status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({}),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('ValueEdge auth poll — workspace access check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.save = mockSave;
    mockSession.accessToken = undefined;
    mockSession.user = undefined;
    mockSave.mockResolvedValue(undefined);
  });

  it('completes login when workspace probe returns 200', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())       // poll for token
      .mockResolvedValueOnce(workspaceResponse(200)) // workspace probe
      .mockResolvedValueOnce(meResponse);            // /v1/auth me

    const res = await request(app).get(POLL_URL);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('returns 403 WORKSPACE_ACCESS_DENIED when workspace probe returns 401', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(workspaceResponse(401));

    const res = await request(app).get(POLL_URL);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns 403 WORKSPACE_ACCESS_DENIED when workspace probe returns 403', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(workspaceResponse(403));

    const res = await request(app).get(POLL_URL);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns 400 WORKSPACE_NOT_FOUND when workspace probe returns 404', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(workspaceResponse(404));

    const res = await request(app).get(POLL_URL);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WORKSPACE_NOT_FOUND');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns 502 BACKEND_ERROR when workspace probe returns 500', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(workspaceResponse(500));

    const res = await request(app).get(POLL_URL);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('BACKEND_ERROR');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns 502 BACKEND_ERROR when workspace probe throws a network error', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse())
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app).get(POLL_URL);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('BACKEND_ERROR');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns pending when token is not yet available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 401,
      text: async () => '',
    });

    const res = await request(app).get(POLL_URL);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(mockSave).not.toHaveBeenCalled();
  });
});
