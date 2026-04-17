import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiError, api } from '../composables/useApi';
import { useToast } from '../composables/useToast';

describe('ApiError', () => {
  it('creates error with status and message', () => {
    const err = new ApiError(404, 'Not found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err).toBeInstanceOf(Error);
  });

  it('includes detail object', () => {
    const detail = { code: 'VALIDATION_ERROR', message: 'bad input' };
    const err = new ApiError(400, 'Validation failed', detail);
    expect(err.detail).toEqual(detail);
  });
});

// ─── Error handling + toast integration ───

function mockFetchResponse(init: {
  status: number;
  contentType?: string;
  body?: string;
}) {
  const headers = new Headers();
  if (init.contentType) headers.set('content-type', init.contentType);
  return {
    status: init.status,
    ok: init.status >= 200 && init.status < 300,
    headers,
    json: async () => (init.body ? JSON.parse(init.body) : null),
    text: async () => init.body || '',
  } as Response;
}

describe('useApi error handling + toasts', () => {
  const { toasts, clearAll } = useToast();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearAll();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('surfaces a toast when the server returns JSON 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INTERNAL', message: 'boom' } }),
    })) as any;

    await expect(api.getOutcomes()).rejects.toThrow('boom');
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]!.variant).toBe('error');
    expect(toasts.value[0]!.title).toBe('Server error');
    expect(toasts.value[0]!.message).toBe('boom');
  });

  it('shows a specific hint when the server returns non-JSON 404 (stale server case)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: '<!DOCTYPE html><html><body><pre>Cannot GET /api/foo</pre></body></html>',
    })) as any;

    await expect(api.getOutcomes()).rejects.toBeInstanceOf(ApiError);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]!.message).toContain('stale code');
    expect(toasts.value[0]!.message).toContain('restart the dev server');
  });

  it('catches network errors (fetch rejects) with a clear toast', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

    await expect(api.getOutcomes()).rejects.toBeInstanceOf(ApiError);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]!.title).toBe('Network error');
    expect(toasts.value[0]!.message).toContain('Could not reach the server');
  });

  it('uses a "Not signed in" title for 401 responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'login please' } }),
    })) as any;

    await expect(api.getOutcomes()).rejects.toBeInstanceOf(ApiError);
    expect(toasts.value[0]!.title).toBe('Not signed in');
  });

  it('does NOT push a toast when getMe() returns 401 (silent probe)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'not authenticated' } }),
    })) as any;

    await expect(api.getMe()).rejects.toBeInstanceOf(ApiError);
    expect(toasts.value).toHaveLength(0);
  });
});
