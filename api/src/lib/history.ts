import { db } from '../db/index.js';
import { history } from '../db/schema.js';
import { flatDiff, createDiff, type AuditChange } from './diff.js';
import type { HistoryEntityType, ChangeType } from '../types.js';

export async function recordHistory(
  entityType: HistoryEntityType,
  entityId: string,
  changeType: ChangeType,
  changes: Record<string, AuditChange>,
  userId: string,
) {
  if (Object.keys(changes).length === 0 && changeType === 'updated') return; // no-op update
  await db.insert(history).values({
    entityType,
    entityId,
    changeType,
    changes,
    changedBy: userId,
  });
}

export async function recordCreate(
  entityType: HistoryEntityType,
  entityId: string,
  entity: Record<string, unknown>,
  userId: string,
) {
  await recordHistory(entityType, entityId, 'created', createDiff(entity), userId);
}

export async function recordUpdate(
  entityType: HistoryEntityType,
  entityId: string,
  oldEntity: Record<string, unknown>,
  newEntity: Record<string, unknown>,
  userId: string,
) {
  const changes = flatDiff(oldEntity, newEntity);
  await recordHistory(entityType, entityId, 'updated', changes, userId);
}

export async function recordLink(outcomeId: string, motivationId: string, userId: string) {
  await recordHistory('outcome_motivation', outcomeId, 'linked', {
    motivation_id: { old: null, new: motivationId },
  }, userId);
  await recordHistory('outcome_motivation', motivationId, 'linked', {
    outcome_id: { old: null, new: outcomeId },
  }, userId);
}

export async function recordUnlink(outcomeId: string, motivationId: string, userId: string) {
  await recordHistory('outcome_motivation', outcomeId, 'unlinked', {
    motivation_id: { old: motivationId, new: null },
  }, userId);
  await recordHistory('outcome_motivation', motivationId, 'unlinked', {
    outcome_id: { old: outcomeId, new: null },
  }, userId);
}
