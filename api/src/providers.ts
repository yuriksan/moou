import type { ProviderConfig } from './types.js';

/**
 * Built-in provider configurations.
 * Each deployment uses one provider, configured via EXTERNAL_PROVIDER env var.
 */
export const PROVIDERS: Record<string, ProviderConfig> = {
  valueedge: {
    name: 'valueedge',
    label: 'OpenText ValueEdge',
    entityTypes: [
      { name: 'epic', label: 'Epic' },
      { name: 'feature', label: 'Feature' },
      { name: 'story', label: 'Story' },
    ],
  },
  github: {
    name: 'github',
    label: 'GitHub',
    entityTypes: [
      { name: 'issue', label: 'Issue' },
      { name: 'pr', label: 'Pull Request' },
    ],
  },
  jira: {
    name: 'jira',
    label: 'Jira',
    entityTypes: [
      { name: 'epic', label: 'Epic' },
      { name: 'story', label: 'Story' },
      { name: 'task', label: 'Task' },
      { name: 'bug', label: 'Bug' },
    ],
  },
  linear: {
    name: 'linear',
    label: 'Linear',
    entityTypes: [
      { name: 'project', label: 'Project' },
      { name: 'issue', label: 'Issue' },
    ],
  },
};

/**
 * Get the configured provider for this deployment.
 * Falls back to 'valueedge' if not set.
 */
export function getProvider(): ProviderConfig {
  const name = process.env.EXTERNAL_PROVIDER || 'valueedge';
  const provider = PROVIDERS[name];
  if (!provider) {
    console.warn(`Unknown provider "${name}", falling back to valueedge`);
    return PROVIDERS.valueedge!;
  }
  return provider;
}

/**
 * Check if an entity type is valid for the configured provider.
 */
export function isValidEntityType(entityType: string): boolean {
  const provider = getProvider();
  // include hidden types (e.g. 'work_item') — they're valid for storage even if not shown in UI
  return provider.entityTypes.some(t => t.name === entityType);
}
