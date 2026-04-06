import { describe, it, expect } from 'vitest';
import { slugify, buildSlugId, extractId } from '../composables/useSlug';

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with hyphens', () => {
    expect(slugify('Upgrade PostgreSQL 14 → 16')).toBe('upgrade-postgresql-14-16');
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugify('  Hello, World!  ')).toBe('hello-world');
  });

  it('strips accents', () => {
    expect(slugify('Café résumé')).toBe('cafe-resume');
  });

  it('caps length at 60 chars', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBe(60);
  });

  it('returns empty string for null/undefined', () => {
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
    expect(slugify('')).toBe('');
  });
});

describe('buildSlugId', () => {
  const uuid = '0361a0f5-c807-42cc-9759-fda2f831e441';

  it('joins slug and uuid with a hyphen', () => {
    expect(buildSlugId('Upgrade PostgreSQL', uuid)).toBe('upgrade-postgresql-0361a0f5-c807-42cc-9759-fda2f831e441');
  });

  it('falls back to bare uuid when title is empty', () => {
    expect(buildSlugId('', uuid)).toBe(uuid);
    expect(buildSlugId(null, uuid)).toBe(uuid);
  });
});

describe('extractId', () => {
  const uuid = '0361a0f5-c807-42cc-9759-fda2f831e441';

  it('extracts the trailing uuid from a slugged path segment', () => {
    expect(extractId(`upgrade-postgresql-14-16-${uuid}`)).toBe(uuid);
  });

  it('extracts a bare uuid', () => {
    expect(extractId(uuid)).toBe(uuid);
  });

  it('returns null when there is no trailing uuid', () => {
    expect(extractId('just-a-slug')).toBeNull();
    expect(extractId('')).toBeNull();
    expect(extractId(null)).toBeNull();
    expect(extractId(undefined)).toBeNull();
  });

  it('is case-insensitive on the uuid', () => {
    const upper = uuid.toUpperCase();
    expect(extractId(`title-${upper}`)).toBe(uuid); // normalised to lowercase
  });

  it('round-trips through buildSlugId', () => {
    const segment = buildSlugId('Some long title with spaces', uuid);
    expect(extractId(segment)).toBe(uuid);
  });
});
