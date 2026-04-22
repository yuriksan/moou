/**
 * Provider adapter interface — generic contract that all issue tracker
 * integrations implement. Routes call this interface, never provider-specific code.
 */

export interface BackendItem {
  entityType: string;
  entityId: string;
  title: string;
  description?: string;
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
  /** Entity type that must be selected as parent when creating this type (e.g. 'epic' for feature, 'feature' for story) */
  parentEntityType?: string;
}

export interface ProviderAdapter {
  name: string;
  label: string;
  descriptionFormat: 'plain' | 'html' | 'markdown';
  entityTypes: ProviderEntityType[];

  /** Search backend items by query string */
  searchItems(token: string, query: string, entityType?: string): Promise<BackendItem[]>;

  /** Get full details of a single item (supports ETag for conditional requests) */
  getItemDetails(token: string, entityType: string, entityId: string, etag?: string): Promise<{ item: BackendItem; etag?: string } | 'not-modified'>;

  /** Get child item progress (e.g. stories under a feature). Returns null if not applicable. */
  getChildProgress(token: string, entityType: string, entityId: string): Promise<ChildProgress | null>;

  /** Create a new item in the backend */
  createItem(
    token: string,
    entityType: string,
    title: string,
    description?: string,
    options?: { parentEntityId?: string; parentEntityType?: string; [key: string]: any },
  ): Promise<{ entityId: string; url: string }>;

  /**
   * Write name and/or description back to a backend item (partial update).
   * Only fields present in `changes` are written.
   */
  updateItem?(token: string, entityType: string, entityId: string, changes: { name?: string; description?: string }): Promise<void>;

  /**
   * Return the fields (required + key optional) needed to create an item of this type,
   * along with pre-fetched allowed values for simple enum-like fields.
   * Returns null if this provider doesn't support dynamic field discovery.
   */
  getCreateOptions?(token: string, entityType: string): Promise<CreateOptions | null>;
}

// ─── Create-form field descriptors ───

export type FieldType = 'string' | 'memo' | 'integer' | 'reference' | 'list_node' | 'date' | 'boolean';

export interface CreateFieldOption {
  id: string;
  name: string;
}

export interface CreateField {
  name: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  /** For list_node / reference fields with a small finite set of values */
  options?: CreateFieldOption[];
  /** For reference fields that need a live search: the backend entity type to search */
  searchEntityType?: string;
  /** For reference fields: the VE entity type string needed when building the payload reference object */
  referenceType?: string;
}

export interface CreateOptions {
  entityType: string;
  /** Parent entity type the user must select (null for epics — parent is fixed). */
  parentEntityType: string | null;
  parentEntityTypeLabel: string | null;
  fields: CreateField[];
}

// ─── Registry ───

import { GitHubAdapter } from './github-adapter.js';
import { ValueEdgeAdapter } from './valueedge-adapter.js';

const adapters: Record<string, ProviderAdapter> = {
  github: new GitHubAdapter(),
  valueedge: new ValueEdgeAdapter(),
};

/**
 * Get the provider adapter for the current deployment.
 * Returns null if the configured provider has no adapter (e.g. mock mode, valueedge without adapter yet).
 */
export function getAdapter(): ProviderAdapter | null {
  const provider = process.env.EXTERNAL_PROVIDER || 'valueedge';
  return adapters[provider] || null;
}
