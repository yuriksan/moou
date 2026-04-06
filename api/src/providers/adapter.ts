/**
 * Provider adapter interface — generic contract that all issue tracker
 * integrations implement. Routes call this interface, never provider-specific code.
 */

export interface BackendItem {
  entityType: string;
  entityId: string;
  title: string;
  state: string;
  stateReason?: string;
  labels: Array<{ name: string; color?: string }>;
  assignee?: { login: string; avatarUrl?: string };
  milestone?: { title: string; dueOn?: string };
  htmlUrl: string;
}

export interface ChildProgress {
  total: number;
  completed: number;
  inProgress: number;
}

export interface ProviderEntityType {
  name: string;
  label: string;
  default?: boolean;
}

export interface ProviderAdapter {
  name: string;
  label: string;
  entityTypes: ProviderEntityType[];

  /** Search backend items by query string */
  searchItems(token: string, query: string, entityType?: string): Promise<BackendItem[]>;

  /** Get full details of a single item (supports ETag for conditional requests) */
  getItemDetails(token: string, entityType: string, entityId: string, etag?: string): Promise<{ item: BackendItem; etag?: string } | 'not-modified'>;

  /** Get child item progress (e.g. stories under a feature). Returns null if not applicable. */
  getChildProgress(token: string, entityType: string, entityId: string): Promise<ChildProgress | null>;

  /** Create a new item in the backend */
  createItem(token: string, entityType: string, title: string, description?: string): Promise<{ entityId: string; url: string }>;
}

// ─── Registry ───

import { GitHubAdapter } from './github-adapter.js';

const adapters: Record<string, ProviderAdapter> = {
  github: new GitHubAdapter(),
};

/**
 * Get the provider adapter for the current deployment.
 * Returns null if the configured provider has no adapter (e.g. mock mode, valueedge without adapter yet).
 */
export function getAdapter(): ProviderAdapter | null {
  const provider = process.env.EXTERNAL_PROVIDER || 'valueedge';
  return adapters[provider] || null;
}
