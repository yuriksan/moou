/**
 * Slugged URL helpers.
 *
 * URLs follow the "decorative slug + ID at the tail" pattern (Linear, Jira,
 * GitHub PRs): the slug is purely cosmetic, the UUID is the source of truth.
 * If an entity's title changes, old URLs still resolve because we extract the
 * ID from the *end* of the slug, not from any positional segment.
 */

// Standard RFC-4122 UUID (any version) anchored to the end of the string.
const UUID_TAIL = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Convert any string to a URL-safe slug. */
export function slugify(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .normalize('NFKD')               // strip accents
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')     // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '')         // trim leading/trailing hyphens
    .slice(0, 60);                   // cap length so URLs stay sane
}

/** Build the URL segment for an entity: `slug-uuid`. */
export function buildSlugId(title: string | null | undefined, id: string): string {
  const slug = slugify(title);
  return slug ? `${slug}-${id}` : id;
}

/** Extract the UUID from a path segment, or null if none is present. */
export function extractId(slugId: string | null | undefined): string | null {
  if (!slugId) return null;
  const match = slugId.match(UUID_TAIL);
  return match ? match[1]!.toLowerCase() : null;
}
