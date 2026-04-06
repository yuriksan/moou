import { toast } from './useToast';

// All API routes are under /api/. In dev, proxy or hit the server directly.
const BASE = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');

let currentUserId = localStorage.getItem('moou-user') || 'sarah-chen';

export function setCurrentUser(userId: string) {
  currentUserId = userId;
  localStorage.setItem('moou-user', userId);
}

export function getCurrentUser() {
  return currentUserId;
}

/**
 * Request options beyond the standard RequestInit.
 * `silent: true` suppresses the automatic error toast. Use for probes that
 * legitimately expect failures (e.g. `getMe()` during app mount, which
 * returns 401 when the user isn't signed in).
 */
export interface RequestOptions extends RequestInit {
  silent?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { silent = false, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((fetchOptions.headers as Record<string, string>) || {}),
  };

  // Add auth header for mutations
  if (fetchOptions.method && fetchOptions.method !== 'GET') {
    headers['X-User-Id'] = currentUserId;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...fetchOptions, headers });
  } catch (err: any) {
    // Network error (server down, CORS block, DNS, etc.)
    const message = 'Could not reach the server. Is the API running?';
    if (!silent) toast.error(message, { title: 'Network error' });
    throw new ApiError(0, message, { code: 'NETWORK_ERROR', message, details: err?.message });
  }

  if (res.status === 204) return undefined as T;

  // Parse the body defensively: the server may return HTML (Express default
  // 404 page, a proxy error page, etc.) and a plain `res.json()` would
  // otherwise explode with a cryptic "Unexpected token '<'" error.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    const snippet = text.slice(0, 120).replace(/\s+/g, ' ').trim();
    const message = res.status === 404
      ? `Server returned non-JSON for ${path} (status 404). The API may be running stale code — restart the dev server.`
      : `Server returned a non-JSON response for ${path} (status ${res.status}).${snippet ? ` Response starts: ${snippet}` : ''}`;
    if (!silent) toast.error(message, { title: 'Unexpected response' });
    throw new ApiError(res.status, message, { code: 'NON_JSON_RESPONSE', message });
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    const message = `Server returned malformed JSON for ${path} (status ${res.status}).`;
    if (!silent) toast.error(message, { title: 'Malformed response' });
    throw new ApiError(res.status, message, { code: 'MALFORMED_JSON', message });
  }

  if (!res.ok) {
    const message = body?.error?.message || `Request failed (${res.status})`;
    if (!silent) {
      const title = res.status === 401 ? 'Not signed in'
        : res.status === 403 ? 'Forbidden'
        : res.status >= 500 ? 'Server error'
        : 'Request failed';
      toast.error(message, { title });
    }
    throw new ApiError(res.status, message, body?.error);
  }

  return body as T;
}

export class ApiError extends Error {
  status: number;
  detail?: { code: string; message: string; details?: unknown };

  constructor(
    status: number,
    message: string,
    detail?: { code: string; message: string; details?: unknown },
  ) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// ─── Typed API methods ───

export const api = {
  // Outcomes
  getOutcomes: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ data: any[]; total: number }>(`/outcomes${qs}`);
  },
  getOutcome: (id: string) => request<any>(`/outcomes/${id}`),
  createOutcome: (data: any) => request<any>('/outcomes', { method: 'POST', body: JSON.stringify(data) }),
  updateOutcome: (id: string, data: any) => request<any>(`/outcomes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteOutcome: (id: string) => request<void>(`/outcomes/${id}`, { method: 'DELETE' }),
  pinOutcome: (id: string) => request<any>(`/outcomes/${id}/pin`, { method: 'PATCH' }),

  // Motivations
  getMotivations: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ data: any[]; total: number }>(`/motivations${qs}`);
  },
  getMotivation: (id: string) => request<any>(`/motivations/${id}`),
  createMotivation: (data: any) => request<any>('/motivations', { method: 'POST', body: JSON.stringify(data) }),
  updateMotivation: (id: string, data: any) => request<any>(`/motivations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMotivation: (id: string) => request<void>(`/motivations/${id}`, { method: 'DELETE' }),
  resolveMotivation: (id: string) => request<any>(`/motivations/${id}/resolve`, { method: 'PATCH' }),
  reopenMotivation: (id: string) => request<any>(`/motivations/${id}/reopen`, { method: 'PATCH' }),
  linkMotivation: (motivationId: string, outcomeId: string) =>
    request<any>(`/motivations/${motivationId}/link/${outcomeId}`, { method: 'POST' }),
  unlinkMotivation: (motivationId: string, outcomeId: string) =>
    request<void>(`/motivations/${motivationId}/link/${outcomeId}`, { method: 'DELETE' }),

  // Milestones
  getMilestones: () => request<{ data: any[]; total: number }>('/milestones'),
  getMilestone: (id: string) => request<any>(`/milestones/${id}`),
  createMilestone: (data: any) => request<any>('/milestones', { method: 'POST', body: JSON.stringify(data) }),
  updateMilestone: (id: string, data: any) => request<any>(`/milestones/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMilestone: (id: string) => request<void>(`/milestones/${id}`, { method: 'DELETE' }),

  // Tags
  getTags: () => request<any[]>('/tags'),
  createTag: (data: any) => request<any>('/tags', { method: 'POST', body: JSON.stringify(data) }),
  updateTag: (id: string, data: any) => request<any>(`/tags/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTag: (id: string) => request<void>(`/tags/${id}`, { method: 'DELETE' }),

  // Comments
  getComments: (outcomeId: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ data: any[]; total: number }>(`/outcomes/${outcomeId}/comments${qs}`);
  },
  createComment: (outcomeId: string, body: string) =>
    request<any>(`/outcomes/${outcomeId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),

  // External Links
  createExternalLink: (outcomeId: string, data: any) =>
    request<any>(`/outcomes/${outcomeId}/external-links`, { method: 'POST', body: JSON.stringify(data) }),
  deleteExternalLink: (id: string) => request<void>(`/external-links/${id}`, { method: 'DELETE' }),

  // History
  getOutcomeHistory: (id: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ data: any[]; total: number }>(`/outcomes/${id}/history${qs}`);
  },
  getMotivationHistory: (id: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ data: any[]; total: number }>(`/motivations/${id}/history${qs}`);
  },

  // Scoring
  getOutcomeScore: (id: string) => request<any>(`/outcomes/${id}/score`),
  recalculateAll: () => request<any>('/scoring/recalculate', { method: 'POST' }),

  // Config
  getMotivationTypes: () => request<any[]>('/motivation-types'),
  getProvider: () => request<any>('/provider'),

  // Auth
  // `silent` because a 401 here is expected when the user isn't signed in —
  // App.vue uses the rejection to decide whether to show the login affordance.
  getMe: () => request<any>('/me', { silent: true }),
  logout: () => fetch(`${BASE.replace('/api', '')}/auth/logout`, { method: 'POST', credentials: 'include' }),

  // Search
  search: (q: string) => request<{ outcomes: any[]; motivations: any[]; tags: any[] }>(`/search?q=${encodeURIComponent(q)}`),

  // Backend integration
  searchBackend: (q: string, type?: string) => {
    const params = new URLSearchParams({ q });
    if (type) params.set('type', type);
    return request<{ items: any[]; provider: string; entityTypes: any[] }>(`/backend/search?${params}`);
  },
  getBackendEntityTypes: () => request<{ entityTypes: any[]; provider: string; label: string }>('/backend/entity-types'),
  connectOutcome: (outcomeId: string, entityType: string, entityId: string) =>
    request<any>(`/outcomes/${outcomeId}/connect`, { method: 'POST', body: JSON.stringify({ entityType, entityId }) }),
  publishOutcome: (outcomeId: string, entityType?: string) =>
    request<any>(`/outcomes/${outcomeId}/publish`, { method: 'POST', body: JSON.stringify({ entityType }) }),
  refreshExternalLink: (linkId: string) =>
    request<any>(`/external-links/${linkId}/refresh`, { method: 'POST' }),

  // Export/Import
  exportTimelineUrl: () => `${BASE}/export/timeline`,
  exportMarkdownUrl: () => `${BASE}/export/timeline/markdown`,
  importTimelineDiff: async (file: File) => {
    const buffer = await file.arrayBuffer();
    const res = await fetch(`${BASE}/import/timeline/diff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-User-Id': currentUserId },
      body: buffer,
    });
    if (!res.ok) throw new ApiError(res.status, 'Import failed');
    return res.json();
  },
  importTimelineApply: (diffs: any[], archiveDeleted: boolean) =>
    request<any>('/import/timeline/apply', { method: 'POST', body: JSON.stringify({ diffs, archiveDeleted }) }),
};
