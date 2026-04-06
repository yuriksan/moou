/**
 * Input validation helpers for API route handlers.
 * Returns { valid: true } or { valid: false, message: string }.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOUR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidUUID(value: unknown): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isValidUUIDArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isValidUUID);
}

export const VALID_OUTCOME_STATUSES = ['draft', 'active', 'approved', 'deferred', 'completed', 'archived'] as const;
export const VALID_EFFORT_SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export const VALID_MILESTONE_STATUSES = ['upcoming', 'active', 'completed'] as const;
export const VALID_MILESTONE_TYPES = ['release', 'deadline', 'review'] as const;

export function validateOutcomeInput(body: Record<string, unknown>): string | null {
  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) return 'title is required';
  if (body.title.length > 500) return 'title must be under 500 characters';
  if (body.description && typeof body.description === 'string' && body.description.length > 50000) return 'description must be under 50000 characters';
  if (body.effort && !VALID_EFFORT_SIZES.includes(body.effort as any)) return `effort must be one of: ${VALID_EFFORT_SIZES.join(', ')}`;
  if (body.status && !VALID_OUTCOME_STATUSES.includes(body.status as any)) return `status must be one of: ${VALID_OUTCOME_STATUSES.join(', ')}`;
  if (body.milestoneId && !isValidUUID(body.milestoneId)) return 'milestoneId must be a valid UUID';
  if (body.tagIds && !isValidUUIDArray(body.tagIds)) return 'tagIds must be an array of UUIDs';
  return null;
}

export function validateMotivationInput(body: Record<string, unknown>): string | null {
  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) return 'title is required';
  if (body.title.length > 500) return 'title must be under 500 characters';
  if (!body.typeId) return 'typeId is required';
  if (!isValidUUID(body.typeId)) return 'typeId must be a valid UUID';
  if (body.tagIds && !isValidUUIDArray(body.tagIds)) return 'tagIds must be an array of UUIDs';
  return null;
}

export function validateMilestoneInput(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) return 'name is required';
  if (!body.targetDate || typeof body.targetDate !== 'string') return 'targetDate is required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)) return 'targetDate must be YYYY-MM-DD format';
  if (body.type && !VALID_MILESTONE_TYPES.includes(body.type as any)) return `type must be one of: ${VALID_MILESTONE_TYPES.join(', ')}`;
  if (body.status && !VALID_MILESTONE_STATUSES.includes(body.status as any)) return `status must be one of: ${VALID_MILESTONE_STATUSES.join(', ')}`;
  return null;
}

export function validateTagInput(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) return 'name is required';
  if (body.name.length > 100) return 'name must be under 100 characters';
  if (body.colour && typeof body.colour === 'string' && !HEX_COLOUR_RE.test(body.colour)) return 'colour must be #RRGGBB format';
  return null;
}

export function validateUUIDParam(id: string): string | null {
  if (!isValidUUID(id)) return 'Invalid ID format';
  return null;
}
