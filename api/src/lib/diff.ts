import diff from 'microdiff';

export interface AuditChange {
  old: unknown;
  new: unknown;
}

/**
 * Deep diff two objects, returning a flat map of dotted-key paths to {old, new} values.
 * e.g. { "attributes.revenue_at_risk": { old: 100000, new: 200000 } }
 */
export function flatDiff(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
): Record<string, AuditChange> {
  const changes = diff(oldObj, newObj);
  const result: Record<string, AuditChange> = {};

  for (const change of changes) {
    const key = change.path.join('.');
    switch (change.type) {
      case 'CREATE':
        result[key] = { old: null, new: change.value };
        break;
      case 'REMOVE':
        result[key] = { old: change.oldValue, new: null };
        break;
      case 'CHANGE':
        result[key] = { old: change.oldValue, new: change.value };
        break;
    }
  }

  return result;
}

/**
 * Create a diff representing entity creation (all fields null → value).
 */
export function createDiff(entity: Record<string, unknown>): Record<string, AuditChange> {
  return flatDiff({}, entity);
}
