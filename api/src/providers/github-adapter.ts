import type { ProviderAdapter, BackendItem, ChildProgress, ProviderEntityType } from './adapter.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_REPO = process.env.GITHUB_REPO || '';

function repoUrl(): string {
  return `${GITHUB_API}/repos/${GITHUB_REPO}`;
}

function headers(token: string, etag?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (etag) h['If-None-Match'] = etag;
  return h;
}

function mapIssue(data: any): BackendItem {
  return {
    entityType: data.pull_request ? 'pr' : 'issue',
    entityId: String(data.number),
    title: data.title,
    description: data.body ?? undefined,
    state: data.pull_request?.merged_at ? 'merged' : data.draft ? 'draft' : data.state,
    stateReason: data.state_reason || undefined,
    labels: (data.labels || []).map((l: any) => ({ name: l.name, color: l.color })),
    assignee: data.assignee ? {
      login: data.assignee.login,
      avatarUrl: data.assignee.avatar_url,
    } : undefined,
    milestone: data.milestone ? {
      title: data.milestone.title,
      dueOn: data.milestone.due_on || undefined,
    } : undefined,
    htmlUrl: data.html_url,
  };
}

export class GitHubAdapter implements ProviderAdapter {
  name = 'github';
  label = 'GitHub';
  descriptionFormat = 'markdown' as const;
  entityTypes: ProviderEntityType[] = [
    { name: 'issue', label: 'Issue', default: true },
    { name: 'pr', label: 'Pull Request' },
  ];

  async searchItems(token: string, query: string, entityType?: string): Promise<BackendItem[]> {
    const typeFilter = entityType === 'pr' ? '+is:pr' : entityType === 'issue' ? '+is:issue' : '';
    const q = encodeURIComponent(`${query}+repo:${GITHUB_REPO}${typeFilter}`);
    const res = await fetch(`${GITHUB_API}/search/issues?q=${q}&per_page=20`, {
      headers: headers(token),
    });

    if (!res.ok) {
      console.error(`GitHub search failed: ${res.status}`);
      return [];
    }

    const data = await res.json() as { items: any[] };
    return data.items.map(mapIssue);
  }

  async getItemDetails(token: string, entityType: string, entityId: string, etag?: string): Promise<{ item: BackendItem; etag?: string } | 'not-modified'> {
    const path = entityType === 'pr'
      ? `${repoUrl()}/pulls/${entityId}`
      : `${repoUrl()}/issues/${entityId}`;

    const res = await fetch(path, { headers: headers(token, etag) });

    if (res.status === 304) return 'not-modified';

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} fetching ${entityType} #${entityId}`);
    }

    const data = await res.json();
    const newEtag = res.headers.get('etag') || undefined;

    // For PRs fetched via the pulls endpoint, check merged state
    if (entityType === 'pr' && data.merged) {
      data.state = 'merged';
    }

    return { item: mapIssue(data), etag: newEtag };
  }

  async getChildProgress(token: string, entityType: string, entityId: string): Promise<ChildProgress | null> {
    // GitHub doesn't have a native parent-child hierarchy for issues.
    // Try the sub-issues API (available on some plans) or return null.
    try {
      const res = await fetch(`${repoUrl()}/issues/${entityId}/sub_issues?per_page=100`, {
        headers: headers(token),
      });

      if (!res.ok) return null;

      const data = await res.json() as any[];
      if (!Array.isArray(data) || data.length === 0) return null;

      const total = data.length;
      const completed = data.filter((i: any) => i.state === 'closed').length;
      const inProgress = total - completed; // GitHub doesn't have "in progress" — open = in progress

      return { total, completed, inProgress };
    } catch {
      return null;
    }
  }

  async createItem(token: string, entityType: string, title: string, description?: string, _options?: { parentEntityId?: string; parentEntityType?: string }): Promise<{ entityId: string; url: string }> {
    if (entityType === 'pr') {
      throw new Error('Cannot create pull requests from moou — create an issue instead');
    }

    const res = await fetch(`${repoUrl()}/issues`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({
        title,
        body: description || '',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(`GitHub API error: ${res.status} — ${err.message || 'failed to create issue'}`);
    }

    const data = await res.json() as { number: number; html_url: string };
    return { entityId: String(data.number), url: data.html_url };
  }

  async updateItem(token: string, entityType: string, entityId: string, changes: { name?: string; description?: string }): Promise<void> {
    if (entityType === 'pr') {
      throw new Error('Cannot update pull requests from moou');
    }

    const body: Record<string, string> = {};
    if (changes.name !== undefined) body.title = changes.name;
    if (changes.description !== undefined) body.body = changes.description;
    if (Object.keys(body).length === 0) return;

    const res = await fetch(`${repoUrl()}/issues/${encodeURIComponent(entityId)}`, {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as any;
      throw new Error(`GitHub API error: ${res.status} — ${err.message || 'failed to update issue'}`);
    }
  }

  async searchDirectory(token: string, query: string, opts?: { cursor?: string; limit?: number }) {
    if (!query || query.length < 2) return { results: [] };

    const limit = opts?.limit || 20;
    const page = opts?.cursor ? (Number(opts.cursor) || 1) : 1;
    const params = new URLSearchParams({
      q: query,
      per_page: String(limit),
      page: String(page),
    });

    const res = await fetch(`${GITHUB_API}/search/users?${params}`, { headers: headers(token) });
    if (res.status === 401 || res.status === 403) {
      const { ProviderAuthError } = await import('./adapter.js');
      throw new ProviderAuthError('GitHub authentication failed. Please sign in again.');
    }
    if (!res.ok) return { results: [] };

    const data = await res.json() as { items: any[]; total_count: number };
    const results = (data.items || []).map((u: any) => ({
      providerId: String(u.id),
      name: u.login,
      handle: u.login,
      avatarUrl: u.avatar_url,
    }));

    const hasMore = data.total_count > page * limit;
    return { results, nextCursor: hasMore ? String(page + 1) : undefined };
  }
}
