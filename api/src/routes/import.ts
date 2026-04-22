import { Router } from 'express';
import ExcelJS from 'exceljs';
import { db } from '../db/index.js';
import { outcomes, motivations, motivationTypes, milestones, outcomeMotivations } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { recordUpdate, recordHistory, recordCreate } from '../lib/history.js';
import { recalculateMotivation, recalculateOutcome } from '../scoring/recalculate.js';
import { broadcast } from '../sse/emitter.js';
import { VALID_OUTCOME_STATUSES, VALID_EFFORT_SIZES, VALID_MILESTONE_STATUSES, VALID_MILESTONE_TYPES, safeSheetName } from '../lib/input-validation.js';

function validateField(field: string, value: unknown): boolean {
  if (field === 'status' && typeof value === 'string') return (VALID_OUTCOME_STATUSES as readonly string[]).includes(value);
  if (field === 'effort' && typeof value === 'string') return (VALID_EFFORT_SIZES as readonly string[]).includes(value);
  return true;
}

const router = Router();

export interface DiffItem {
  type: 'outcome_modified' | 'motivation_modified' | 'outcome_created' | 'outcome_deleted' | 'outcome_moved' | 'milestone_modified';
  entityType: 'outcome' | 'motivation' | 'milestone';
  entityId?: string;
  title: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  sheetName: string;
}

function getCell(row: ExcelJS.Row, headers: string[], headerName: string): unknown {
  const idx = headers.indexOf(headerName);
  if (idx < 0) return null;
  const val = row.getCell(idx + 1).value; // ExcelJS is 1-indexed
  // Handle ExcelJS rich text objects
  if (val && typeof val === 'object' && 'richText' in (val as any)) {
    return (val as any).richText.map((r: any) => r.text).join('');
  }
  return val;
}

function cellStr(row: ExcelJS.Row, headers: string[], headerName: string): string {
  const val = getCell(row, headers, headerName);
  if (val instanceof Date) return val.toISOString().split('T')[0]!;
  return String(val ?? '').trim();
}

function parseHeaders(sheet: ExcelJS.Worksheet): string[] {
  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value || '').trim();
  });
  return headers;
}

// ─── POST /import/timeline/diff — upload spreadsheet, return diff ───

router.post('/timeline/diff', async (req, res) => {
  if (!req.body || !Buffer.isBuffer(req.body)) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No file uploaded' } });
      return;
    }
    req.body = Buffer.concat(chunks);
  }

  // Validate XLSX magic bytes
  const raw = req.body as any;
  const bytes = raw instanceof Uint8Array ? raw : Buffer.from(raw);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid file — expected an .xlsx spreadsheet' } });
    return;
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as any);
  } catch {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Could not parse spreadsheet' } });
    return;
  }

  // Enforce new format: require Milestones sheet
  const msSheet = workbook.getWorksheet('Milestones');
  if (!msSheet) {
    res.status(400).json({
      error: {
        code: 'FORMAT_ERROR',
        message: 'This spreadsheet uses an older export format. Please re-export from moou.',
      },
    });
    return;
  }

  // Limit sheet count to prevent abuse on upload
  const MAX_SHEETS = 50;
  if (workbook.worksheets.length > MAX_SHEETS) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: `Spreadsheet has ${workbook.worksheets.length} sheets — maximum allowed is ${MAX_SHEETS}.`,
      },
    });
    return;
  }

  const MAX_ROWS_PER_SHEET = 10_000;
  const diffs: DiffItem[] = [];

  // Load current DB state
  const currentOutcomes = await db.select().from(outcomes);
  const currentMotivations = await db.select().from(motivations);
  const currentMilestones = await db.select().from(milestones);
  const currentTypes = await db.select().from(motivationTypes);
  const outcomeMap = new Map(currentOutcomes.map(o => [o.id, o]));
  const motivationMap = new Map(currentMotivations.map(m => [m.id, m]));
  const milestoneMap = new Map(currentMilestones.map(m => [m.id, m]));
  const milestoneByName = new Map(currentMilestones.map(m => [m.name, m]));

  // ─── 1. Parse Milestones sheet ───
  const msHeaders = parseHeaders(msSheet);
  const maxMsRow = Math.min(msSheet.rowCount, MAX_ROWS_PER_SHEET + 1);

  for (let rowNum = 2; rowNum <= maxMsRow; rowNum++) {
    const row = msSheet.getRow(rowNum);
    if (!row.hasValues) continue;

    const msId = cellStr(row, msHeaders, 'Milestone ID');
    const msName = cellStr(row, msHeaders, 'Name');
    // Intentionally skip rows without an existing Milestone ID — new milestones
    // are created via the app, not via spreadsheet import.
    if (!msId || !milestoneMap.has(msId)) continue;

    const existing = milestoneMap.get(msId)!;
    const changes: Record<string, { old: unknown; new: unknown }> = {};

    if (msName && msName !== existing.name) changes.name = { old: existing.name, new: msName };

    const newDate = cellStr(row, msHeaders, 'Target Date');
    if (newDate && newDate !== existing.targetDate) changes.targetDate = { old: existing.targetDate, new: newDate };

    const newType = cellStr(row, msHeaders, 'Type');
    if (newType && newType !== (existing.type || 'release')) changes.type = { old: existing.type, new: newType };

    const newStatus = cellStr(row, msHeaders, 'Status');
    if (newStatus && newStatus !== (existing.status || 'upcoming')) changes.status = { old: existing.status, new: newStatus };

    if (Object.keys(changes).length > 0) {
      diffs.push({
        type: 'milestone_modified',
        entityType: 'milestone',
        entityId: msId,
        title: msName || existing.name,
        changes,
        sheetName: 'Milestones',
      });
    }
  }

  // ─── 2. Parse Timeline sheet ───
  const tlSheet = workbook.getWorksheet('Timeline');
  const seenOutcomeIds = new Set<string>();

  if (tlSheet) {
    const tlHeaders = parseHeaders(tlSheet);
    const maxTlRow = Math.min(tlSheet.rowCount, MAX_ROWS_PER_SHEET + 1);

    for (let rowNum = 2; rowNum <= maxTlRow; rowNum++) {
      const row = tlSheet.getRow(rowNum);
      if (!row.hasValues) continue;

      const outcomeId = cellStr(row, tlHeaders, 'Outcome ID');
      const outcomeTitle = cellStr(row, tlHeaders, 'Outcome');

      if (outcomeId && outcomeMap.has(outcomeId) && !seenOutcomeIds.has(outcomeId)) {
        seenOutcomeIds.add(outcomeId);
        const existing = outcomeMap.get(outcomeId)!;
        const changes: Record<string, { old: unknown; new: unknown }> = {};

        const newTitle = outcomeTitle || existing.title;
        if (newTitle !== existing.title) changes.title = { old: existing.title, new: newTitle };

        const newDesc = cellStr(row, tlHeaders, 'Description') || null;
        if (newDesc !== existing.description) changes.description = { old: existing.description, new: newDesc };

        const newEffort = cellStr(row, tlHeaders, 'Effort') || null;
        if (newEffort !== existing.effort) changes.effort = { old: existing.effort, new: newEffort };

        const newStatus = cellStr(row, tlHeaders, 'Status') || existing.status;
        if (newStatus !== existing.status) changes.status = { old: existing.status, new: newStatus };

        // Milestone from column (not sheet name)
        const newMilestoneName = cellStr(row, tlHeaders, 'Milestone');
        const currentMsName = milestoneMap.get(existing.milestoneId ?? '')?.name || '';
        if (newMilestoneName !== currentMsName) {
          changes.milestone = { old: currentMsName || null, new: newMilestoneName || null };
        }

        if (Object.keys(changes).length > 0) {
          diffs.push({
            type: changes.milestone ? 'outcome_moved' : 'outcome_modified',
            entityType: 'outcome',
            entityId: outcomeId,
            title: newTitle || existing.title,
            changes,
            sheetName: 'Timeline',
          });
        }
      } else if (!outcomeId && outcomeTitle) {
        // New outcome
        diffs.push({
          type: 'outcome_created',
          entityType: 'outcome',
          title: outcomeTitle,
          changes: {
            title: { old: null, new: outcomeTitle },
            effort: { old: null, new: cellStr(row, tlHeaders, 'Effort') || null },
            status: { old: null, new: cellStr(row, tlHeaders, 'Status') || 'draft' },
            milestone: { old: null, new: cellStr(row, tlHeaders, 'Milestone') || null },
          },
          sheetName: 'Timeline',
        });
      }
    }
  }

  // ─── 3. Parse motivation type sheets ───
  const seenMotivationIds = new Set<string>();
  for (const type of currentTypes) {
    // Export creates sheets with safeSheetName(type.name), so look up using the same sanitisation.
    const typeSheet = workbook.getWorksheet(safeSheetName(type.name));
    if (!typeSheet) continue;

    const typeHeaders = parseHeaders(typeSheet);
    const maxRow = Math.min(typeSheet.rowCount, MAX_ROWS_PER_SHEET + 1);

    for (let rowNum = 2; rowNum <= maxRow; rowNum++) {
      const row = typeSheet.getRow(rowNum);
      if (!row.hasValues) continue;

      const motId = cellStr(row, typeHeaders, 'Motivation ID');
      if (!motId || !motivationMap.has(motId) || seenMotivationIds.has(motId)) continue;
      seenMotivationIds.add(motId);

      const existing = motivationMap.get(motId)!;
      const existingAttrs = (existing.attributes as Record<string, unknown>) || {};
      const changes: Record<string, { old: unknown; new: unknown }> = {};

      // Check status
      const newMotStatus = cellStr(row, typeHeaders, 'Status');
      if (newMotStatus && newMotStatus !== existing.status) {
        changes.status = { old: existing.status, new: newMotStatus };
      }

      // Check title
      const newMotTitle = cellStr(row, typeHeaders, 'Motivation');
      if (newMotTitle && newMotTitle !== existing.title) {
        changes.title = { old: existing.title, new: newMotTitle };
      }

      // Check attribute changes — scan columns that match type's schema
      const schema = type.attributeSchema as { properties?: Record<string, Record<string, unknown>> };
      const attrKeys = Object.keys(schema.properties || {});
      for (const key of attrKeys) {
        const header = key.replace(/_/g, ' ');
        const rawVal = getCell(row, typeHeaders, header);
        let newVal: unknown = rawVal;

        // Normalize types
        if (rawVal instanceof Date) newVal = rawVal.toISOString().split('T')[0];
        if (typeof rawVal === 'string') newVal = rawVal.trim() || undefined;
        if (newVal === '' || newVal === null) newVal = undefined;

        // Boolean normalization
        if (typeof newVal === 'string' && (newVal.toUpperCase() === 'TRUE' || newVal.toUpperCase() === 'FALSE')) {
          newVal = newVal.toUpperCase() === 'TRUE';
        }

        const oldVal = existingAttrs[key] === null || existingAttrs[key] === undefined ? undefined : existingAttrs[key];

        if (newVal !== undefined && String(newVal) !== String(oldVal)) {
          changes[`attributes.${key}`] = { old: oldVal, new: newVal };
        }
      }

      if (Object.keys(changes).length > 0) {
        diffs.push({
          type: 'motivation_modified',
          entityType: 'motivation',
          entityId: motId,
          title: newMotTitle || existing.title,
          changes,
          sheetName: type.name,
        });
      }
    }
  }

  // ─── 4. Detect deleted outcomes ───
  // Only detect deletions when the Timeline sheet is present; if it's missing
  // seenOutcomeIds will be empty and every existing outcome would be flagged.
  if (tlSheet) {
    for (const [id, o] of outcomeMap) {
      if (!seenOutcomeIds.has(id)) {
        diffs.push({
          type: 'outcome_deleted',
          entityType: 'outcome',
          entityId: id,
          title: o.title,
          changes: { title: { old: o.title, new: null } },
          sheetName: 'Deleted',
        });
      }
    }
  }

  res.json({
    diffs,
    summary: {
      total: diffs.length,
      modified: diffs.filter(d => d.type.includes('modified')).length,
      created: diffs.filter(d => d.type === 'outcome_created').length,
      deleted: diffs.filter(d => d.type === 'outcome_deleted').length,
      moved: diffs.filter(d => d.type === 'outcome_moved').length,
    },
  });
});

// ─── POST /import/timeline/apply — apply selected diffs ───

router.post('/timeline/apply', async (req, res) => {
  const { diffs, archiveDeleted } = req.body as { diffs: DiffItem[]; archiveDeleted?: boolean };
  if (!diffs || !Array.isArray(diffs)) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'diffs array required' } });
    return;
  }

  const currentMilestones = await db.select().from(milestones);
  const milestoneByName = new Map(currentMilestones.map(m => [m.name, m]));
  const applied: string[] = [];

  for (const diff of diffs) {
    try {
      if (diff.type === 'milestone_modified') {
        if (!diff.entityId) continue;
        const [existing] = await db.select().from(milestones).where(eq(milestones.id, diff.entityId)).limit(1);
        if (!existing) continue;

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        if (diff.changes.name) updates.name = diff.changes.name.new;
        if (diff.changes.targetDate) updates.targetDate = diff.changes.targetDate.new;
        if (diff.changes.type) {
          const t = diff.changes.type.new as string;
          if (!(VALID_MILESTONE_TYPES as readonly string[]).includes(t)) { applied.push(`SKIPPED: ${diff.title} — invalid type "${t}"`); continue; }
          updates.type = t;
        }
        if (diff.changes.status) {
          const s = diff.changes.status.new as string;
          if (!(VALID_MILESTONE_STATUSES as readonly string[]).includes(s)) { applied.push(`SKIPPED: ${diff.title} — invalid status "${s}"`); continue; }
          updates.status = s;
        }

        await db.update(milestones).set(updates as any).where(eq(milestones.id, diff.entityId));
        // Keep milestoneByName in sync so later diffs resolve the new name
        if (diff.changes.name) {
          milestoneByName.delete(existing.name);
          milestoneByName.set(diff.changes.name.new as string, { ...existing, ...updates } as any);
        }
        applied.push(`Updated milestone: ${diff.title}`);

      } else if (diff.type === 'outcome_modified' || diff.type === 'outcome_moved') {
        if (!diff.entityId) continue;
        const [existing] = await db.select().from(outcomes).where(eq(outcomes.id, diff.entityId)).limit(1);
        if (!existing) continue;

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        for (const [field, change] of Object.entries(diff.changes)) {
          if (!validateField(field, change.new)) {
            applied.push(`SKIPPED: ${diff.title} — invalid ${field} value "${change.new}"`);
            continue;
          }
        }
        if (diff.changes.title) updates.title = diff.changes.title.new;
        if (diff.changes.description) updates.description = diff.changes.description.new;
        if (diff.changes.effort) updates.effort = diff.changes.effort.new;
        if (diff.changes.status) updates.status = diff.changes.status.new;
        if (diff.changes.milestone) {
          const msName = diff.changes.milestone.new as string;
          if (msName) {
            const matched = milestoneByName.get(msName);
            if (!matched) {
              applied.push(`SKIPPED: ${diff.title} — unknown milestone "${msName}"`);
              continue;
            }
            updates.milestoneId = matched.id;
          } else {
            updates.milestoneId = null;
          }
        }

        await db.update(outcomes).set(updates as any).where(eq(outcomes.id, diff.entityId));
        await recordUpdate('outcome', diff.entityId, existing as any, { ...existing, ...updates } as any, req.user!.id);
        await recalculateOutcome(diff.entityId);
        broadcast({ type: 'outcome_updated', id: diff.entityId });
        applied.push(`Updated outcome: ${diff.title}`);

      } else if (diff.type === 'motivation_modified') {
        if (!diff.entityId) continue;
        const [existing] = await db.select().from(motivations).where(eq(motivations.id, diff.entityId)).limit(1);
        if (!existing) continue;

        const newAttrs = { ...(existing.attributes as Record<string, unknown>) };
        const updates: Record<string, unknown> = { updatedAt: new Date() };

        for (const [key, change] of Object.entries(diff.changes)) {
          if (key.startsWith('attributes.')) {
            newAttrs[key.replace('attributes.', '')] = change.new;
          } else if (key === 'status') {
            updates.status = change.new;
          } else if (key === 'title') {
            updates.title = change.new;
          }
        }
        updates.attributes = newAttrs;

        await db.update(motivations).set(updates as any).where(eq(motivations.id, diff.entityId));
        await recordUpdate('motivation', diff.entityId, existing as any, { ...existing, ...updates } as any, req.user!.id);
        await recalculateMotivation(diff.entityId);
        const links = await db.select({ outcomeId: outcomeMotivations.outcomeId }).from(outcomeMotivations).where(eq(outcomeMotivations.motivationId, diff.entityId));
        for (const link of links) { await recalculateOutcome(link.outcomeId); }
        broadcast({ type: 'motivation_updated', id: diff.entityId });
        applied.push(`Updated motivation: ${diff.title}`);

      } else if (diff.type === 'outcome_created') {
        const msName = diff.changes.milestone?.new as string;
        let newMilestoneId: string | null = null;
        if (msName) {
          const matched = milestoneByName.get(msName);
          if (!matched) {
            applied.push(`SKIPPED: ${diff.title} — unknown milestone "${msName}"`);
            continue;
          }
          newMilestoneId = matched.id;
        }
        const rawEffort = diff.changes.effort?.new;
        const rawStatus = diff.changes.status?.new;
        const validatedEffort = typeof rawEffort === 'string' && validateField('effort', rawEffort) ? rawEffort : null;
        const validatedStatus = typeof rawStatus === 'string' && validateField('status', rawStatus) ? rawStatus : 'draft';
        const [created] = await db.insert(outcomes).values({
          title: diff.changes.title?.new as string || diff.title,
          effort: validatedEffort,
          status: validatedStatus,
          milestoneId: newMilestoneId,
          createdBy: req.user!.id,
        }).returning() as any[];
        await recordCreate('outcome', created.id, created as any, req.user!.id);
        broadcast({ type: 'outcome_created', id: created.id });
        applied.push(`Created outcome: ${diff.title}`);

      } else if (diff.type === 'outcome_deleted') {
        if (!diff.entityId) continue;
        if (archiveDeleted) {
          await db.update(outcomes).set({ status: 'archived', updatedAt: new Date() } as any).where(eq(outcomes.id, diff.entityId));
          await recordHistory('outcome', diff.entityId, 'updated', { status: { old: 'active', new: 'archived' } }, req.user!.id);
          broadcast({ type: 'outcome_updated', id: diff.entityId });
          applied.push(`Archived outcome: ${diff.title}`);
        } else {
          await db.delete(outcomes).where(eq(outcomes.id, diff.entityId));
          broadcast({ type: 'outcome_deleted', id: diff.entityId });
          applied.push(`Deleted outcome: ${diff.title}`);
        }
      }
    } catch (err: any) {
      applied.push(`FAILED: ${diff.title} — ${err.message}`);
    }
  }

  res.json({ applied });
});

export default router;
