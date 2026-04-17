/**
 * Strip the provider prefix (e.g. "github:") from a user ID string.
 */
export function stripProvider(id: string | null): string {
  if (!id) return '';
  const i = id.indexOf(':');
  return i >= 0 ? id.slice(i + 1) : id;
}
