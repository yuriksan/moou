import type { ProviderAdapter } from './adapter.js';
import { GitHubAdapter } from './github-adapter.js';
import { ValueEdgeAdapter } from './valueedge-adapter.js';

const adapters: Record<string, ProviderAdapter> = {
  github: new GitHubAdapter(),
  valueedge: new ValueEdgeAdapter(),
};

/**
 * Get the provider adapter for the current deployment.
 * Returns null if the configured provider has no adapter.
 */
export function getAdapter(): ProviderAdapter | null {
  const provider = process.env.EXTERNAL_PROVIDER || 'valueedge';
  return adapters[provider] || null;
}
