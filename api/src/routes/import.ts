import { Router } from 'express';
import ExcelJS from 'exceljs';
import { db } from '../db/index.js';
import { outcomes, motivations, motivationTypes, milestones, outcomeMotivations } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { recordUpdate, recordHistory, recordCreate } from '../lib/history.js';
import { recalculateMotivation, recalculateOutcome } from '../scoring/recalculate.js';
import { broadcast } from '../sse/emitter.js';

const VALID_STATUSES = ['draft', 'active', 'approved', 'deferred', 'completed', 'archived'];
const VALID_EFFORTS = ['XS', 'S', 'M', 'L', 'XL'];

function validateField(field: string, value: unknown): boolean {
  if (field === 'status' && typeof value === 'string') return VALID_STATUSES.includes(value);
  if (field === 'effort' && typeof value === 'string') return VALID_EFFORTS.includes(value);
  return true; // other fields pass through
}

const router = Router();

export interface DiffItem {
  type: 'outcome_modified' | 'motivation_modified' | 'outcome_created' | 'outcome_deleted' | 'outcome_moved';
  entityType: 'outcome' | 'motivation';
  entityId?: string;
  title: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  sheetName: string;
}

// ─── POST /import/timeline/diff — upload spreadsheet, return diff ───

router.post('/timeline/diff', async (req, res) => {
  if (!req.body || !Buffer.isBuffer(req.body)) {
    // Try to read from raw body
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

  // Validate file is XLSX (ZIP magic bytes: PK\x03\x04)
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

  // Limit processing
  const MAX_SHEETS = 50;
  const MAX_ROWS_PER_SHEET = 10_000;
  if (workbook.worksheets.length > MAX_SHEETS) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Too many sheets (max ${MAX_SHEETS})` } });
    return;
  }

  const diffs: DiffItem[] = [];

  // Get current data for comparison
  const currentOutcomes = await db.select().from(outcomes);
  const currentMotivations = await db.select().from(motivations);
  const currentMilestones = await db.select().from(milestones);
  const outcomeMap = new Map(currentOutcomes.map(o => [o.id, o]));
  const motivationMap = new Map(currentMotivations.map(m => [m.id, m]));
  const milestoneByName = new Map(currentMilestones.map(m => [m.name, m]));

  const seenOutcomeIds = new Set<string>();
  const seenMotivationIds = new Set<string>();

  for (const sheet of workbook.worksheets) {
    const sheetName = sheet.name;
    const milestoneForSheet = milestoneByName.get(sheetName);

    // Parse header row
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber] = String(cell.value || '').trim();
    });

    // Map column names to indices
    const colIndex = (name: string) => headers.findIndex(h => h === name) + 0; // 0-indexed from headers array
    const getCell = (row: ExcelJS.Row, headerName: string): unknown => {
      const idx = headers.indexOf(headerName);
      if (idx < 0) return null;
      return row.getCell(idx + 1).value; // ExcelJS is 1-indexed
    };

    // Process data rows
    const maxRow = Math.min(sheet.rowCount, MAX_ROWS_PER_SHEET + 1);
    for (let rowNum = 2; rowNum <= maxRow; rowNum++) {
      const row = sheet.getRow(rowNum);
      if (!row.hasValues) continue;

      // ─── Check outcome changes ───
      const outcomeId = String(getCell(row, 'Outcome ID') || '').trim();
      const outcomeTitle = String(getCell(row, 'Outcome') || '').trim();

      if (outcomeId && outcomeMap.has(outcomeId) && !seenOutcomeIds.has(outcomeId)) {
        seenOutcomeIds.add(outcomeId);
        const existing = outcomeMap.get(outcomeId)!;
        const changes: Record<string, { old: unknown; new: unknown }> = {};

        // Check field changes
        const newTitle = outcomeTitle || existing.title;
        if (newTitle !== existing.title) changes.title = { old: existing.title, new: newTitle };

        const newDesc = String(getCell(row, 'Description') || '') || null;
        if (newDesc !== existing.description) changes.description = { old: existing.description, new: newDesc };

        const newEffort = String(getCell(row, 'Effort') || '') || null;
        if (newEffort !== existing.effort) changes.effort = { old: existing.effort, new: newEffort };

        const newStatus = String(getCell(row, 'Status') || '') || existing.status;
        if (newStatus !== existing.status) changes.status = { old: existing.status, new: newStatus };

        // Check milestone change (outcome moved between sheets)
        const currentMsName = currentMilestones.find(m => m.id === existing.milestoneId)?.name || 'Backlog';
        if (sheetName !== currentMsName) {
          changes.milestone = { old: currentMsName, new: sheetName };
        }

        if (Object.keys(changes).length > 0) {
          diffs.push({
            type: sheetName !== currentMsName ? 'outcome_moved' : 'outcome_modified',
            entityType: 'outcome',
            entityId: outcomeId,
            title: newTitle || existing.title,
            changes,
            sheetName,
          });
        }
      } else if (!outcomeId && outcomeTitle) {
        // New outcome (no ID but has a title)
        diffs.push({
          type: 'outcome_created',
          entityType: 'outcome',
          title: outcomeTitle,
          changes: {
            title: { old: null, new: outcomeTitle },
            effort: { old: null, new: getCell(row, 'Effort') },
            status: { old: null, new: getCell(row, 'Status') || 'draft' },
            milestone: { old: null, new: sheetName },
          },
          sheetName,
        });
      }

      // ─── Check motivation changes ───
      const motivationId = String(getCell(row, 'Motivation ID') || '').trim();
      if (motivationId && motivationMap.has(motivationId) && !seenMotivationIds.has(motivationId)) {
        seenMotivationIds.add(motivationId);
        const existing = motivationMap.get(motivationId)!;
        const changes: Record<string, { old: unknown; new: unknown }> = {};
        const existingAttrs = existing.attributes as Record<string, unknown>;

        // Check attribute changes — scan attr_ columns
        for (const header of headers) {
          if (!header) continue;
          // Map "revenue at risk" back to "revenue_at_risk"
          const attrKey = header.replace(/ /g, '_');
          if (attrKey in (existingAttrs || {})) {
            const cellValue = getCell(row, header);
            const currentValue = existingAttrs[attrKey];
            // Normalize for comparison
            const newVal = cellValue === null || cellValue === undefined || cellValue === '' ? undefined : cellValue;
            const oldVal = currentValue === null || currentValue === undefined ? undefined : currentValue;
            if (newVal !== undefined && String(newVal) !== String(oldVal)) {
              changes[`attributes.${attrKey}`] = { old: oldVal, new: newVal };
            }
          }
        }

        const newMotStatus = String(getCell(row, 'Motivation Status') || '');
        if (newMotStatus && newMotStatus !== existing.status) {
          changes.status = { old: existing.status, new: newMotStatus };
        }

        if (Object.keys(changes).length > 0) {
          diffs.push({
            type: 'motivation_modified',
            entityType: 'motivation',
            entityId: motivationId,
            title: String(getCell(row, 'Motivation') || existing.title),
            changes,
            sheetName,
          });
        }
      }
    }
  }

  // Check for deleted outcomes (present in DB but not in spreadsheet)
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

  res.json({ diffs, summary: { total: diffs.length, modified: diffs.filter(d => d.type.includes('modified')).length, created: diffs.filter(d => d.type === 'outcome_created').length, deleted: diffs.filter(d => d.type === 'outcome_deleted').length, moved: diffs.filter(d => d.type === 'outcome_moved').length } });
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
      if (diff.type === 'outcome_modified' || diff.type === 'outcome_moved') {
        if (!diff.entityId) continue;
        const [existing] = await db.select().from(outcomes).where(eq(outcomes.id, diff.entityId)).limit(1);
        if (!existing) continue;

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        // Validate enum fields before applying
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
          const targetMs = milestoneByName.get(diff.changes.milestone.new as string);
          updates.milestoneId = targetMs?.id || null;
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
            const attrKey = key.replace('attributes.', '');
            newAttrs[attrKey] = change.new;
          } else if (key === 'status') {
            updates.status = change.new;
          }
        }
        updates.attributes = newAttrs;

        await db.update(motivations).set(updates as any).where(eq(motivations.id, diff.entityId));
        await recordUpdate('motivation', diff.entityId, existing as any, { ...existing, ...updates } as any, req.user!.id);
        await recalculateMotivation(diff.entityId);
        // Recalculate linked outcomes
        const links = await db.select({ outcomeId: outcomeMotivations.outcomeId }).from(outcomeMotivations).where(eq(outcomeMotivations.motivationId, diff.entityId));
        for (const link of links) { await recalculateOutcome(link.outcomeId); }
        broadcast({ type: 'motivation_updated', id: diff.entityId });
        applied.push(`Updated motivation: ${diff.title}`);

      } else if (diff.type === 'outcome_created') {
        const targetMs = milestoneByName.get(diff.sheetName);
        const [created] = await db.insert(outcomes).values({
          title: diff.changes.title?.new as string || diff.title,
          effort: diff.changes.effort?.new as string || null,
          status: (diff.changes.status?.new as string) || 'draft',
          milestoneId: targetMs?.id || null,
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
