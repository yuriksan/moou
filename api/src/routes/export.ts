import { Router } from 'express';
import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');
import { db } from '../db/index.js';
import { outcomes, motivations, motivationTypes, outcomeMotivations, milestones, outcomeTags, motivationTags, tags, externalLinks } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { VALID_OUTCOME_STATUSES, VALID_EFFORT_SIZES, VALID_MILESTONE_STATUSES, VALID_MILESTONE_TYPES, safeSheetName } from '../lib/input-validation.js';
import { getAdapter } from '../providers/adapter.js';

const router = Router();

// ─── Sanitization ───

function sanitizeCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function escapeMarkdown(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/([\\`*_\[\]()<>|!])/g, '\\$1');
}

function escapeMarkdownBlock(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .split('\n')
    .map(line => {
      const inlineEscaped = escapeMarkdown(line);
      return inlineEscaped.replace(
        /^(\s*)(#{1,6}\s|>\s|[-+]\s|\d+\.\s)/,
        (_match, ws, marker) => ws + '\\' + marker,
      );
    })
    .join('\n');
}

// ─── Shared data types ───

interface OutcomeRow {
  id: string;
  title: string;
  description: string | null;
  effort: string | null;
  status: string;
  priorityScore: string;
  milestoneId: string | null;
  milestoneName: string | null;
  milestoneDate: string | null;
  tagSet: Set<string>;
  tags: string;
  motivationCount: number;
  topMotivationType: string | null;
  motivationSummary: string;
  primaryLinkUrl: string | null;
}

interface MotivationRow {
  id: string;
  title: string;
  outcomeId: string;
  outcomeTitle: string;
  typeName: string;
  score: string | null;
  status: string;
  targetDate: string | null;
  attributes: Record<string, unknown>;
}

interface MilestoneRow {
  id: string;
  name: string;
  targetDate: string;
  type: string;
  status: string;
  outcomeCount: number;
  avgPriorityScore: number;
  completedCount: number;
}

// ─── Build structured export data ───

async function buildStructuredData() {
  // Fetch all milestones
  const allMilestones = await db.select().from(milestones).orderBy(sql`${milestones.targetDate} ASC`);

  // Fetch all outcomes with milestone info and primary link URL
  const allOutcomes = await db.select({
    id: outcomes.id,
    title: outcomes.title,
    description: outcomes.description,
    effort: outcomes.effort,
    status: outcomes.status,
    priorityScore: outcomes.priorityScore,
    milestoneId: outcomes.milestoneId,
    milestoneName: milestones.name,
    milestoneDate: milestones.targetDate,
    primaryLinkUrl: externalLinks.url,
  }).from(outcomes)
    .leftJoin(milestones, eq(outcomes.milestoneId, milestones.id))
    .leftJoin(externalLinks, eq(outcomes.primaryLinkId, externalLinks.id))
    .orderBy(sql`${milestones.targetDate} NULLS LAST`, sql`${outcomes.priorityScore} DESC`);

  // Fetch all motivation links with details
  const allLinks = await db.select({
    outcomeId: outcomeMotivations.outcomeId,
    motivationId: motivations.id,
    motivationTitle: motivations.title,
    motivationType: motivationTypes.name,
    motivationScore: motivations.score,
    motivationStatus: motivations.status,
    motivationTargetDate: motivations.targetDate,
    motivationAttributes: motivations.attributes,
  }).from(outcomeMotivations)
    .innerJoin(motivations, eq(outcomeMotivations.motivationId, motivations.id))
    .innerJoin(motivationTypes, eq(motivations.typeId, motivationTypes.id));

  // Fetch motivation type schemas
  const allTypes = await db.select().from(motivationTypes);

  // Fetch effective tags per outcome: union of direct outcome_tags and tags inherited from linked motivations
  const allOutcomeTags = await db.execute<{ outcome_id: string; tag_name: string }>(sql`
    SELECT o.id AS outcome_id, t.name AS tag_name
    FROM outcomes o
    JOIN (
      SELECT ot.outcome_id, t.name FROM outcome_tags ot JOIN tags t ON t.id = ot.tag_id
      UNION
      SELECT om.outcome_id, t.name
      FROM outcome_motivations om
        JOIN motivation_tags mt ON mt.motivation_id = om.motivation_id
        JOIN tags t ON t.id = mt.tag_id
    ) t ON t.outcome_id = o.id
  `).then(r => r.rows.map(row => ({ outcomeId: row.outcome_id, tagName: row.tag_name })));

  const outcomeTagMap = new Map<string, Set<string>>();
  const allTagNames = new Set<string>();
  for (const ot of allOutcomeTags) {
    if (!outcomeTagMap.has(ot.outcomeId)) outcomeTagMap.set(ot.outcomeId, new Set());
    outcomeTagMap.get(ot.outcomeId)!.add(ot.tagName);
    allTagNames.add(ot.tagName);
  }
  const sortedTagNames = [...allTagNames].sort((a, b) => a.localeCompare(b));

  // Group links by outcome
  const linksByOutcome = new Map<string, typeof allLinks>();
  for (const link of allLinks) {
    if (!linksByOutcome.has(link.outcomeId)) linksByOutcome.set(link.outcomeId, []);
    linksByOutcome.get(link.outcomeId)!.push(link);
  }

  // Build outcome rows for Timeline sheet
  const outcomeRows: OutcomeRow[] = allOutcomes.map(o => {
    const oLinks = linksByOutcome.get(o.id) || [];
    const oTags = [...(outcomeTagMap.get(o.id) ?? [])].join(', ');

    // Find top motivation (highest score)
    let topType: string | null = null;
    let topScore = -Infinity;
    const summaryLines: string[] = [];
    for (const link of oLinks) {
      const s = Number(link.motivationScore || 0);
      summaryLines.push(`${link.motivationType}: "${link.motivationTitle}" (score: ${s.toLocaleString('en', { maximumFractionDigits: 0 })})`);
      if (s > topScore) { topScore = s; topType = link.motivationType; }
    }

    return {
      id: o.id,
      title: o.title,
      description: o.description,
      effort: o.effort,
      status: o.status,
      priorityScore: o.priorityScore,
      milestoneId: o.milestoneId,
      milestoneName: o.milestoneName,
      milestoneDate: o.milestoneDate,
      tagSet: outcomeTagMap.get(o.id) || new Set(),
      tags: oTags,
      motivationCount: oLinks.length,
      topMotivationType: topType,
      motivationSummary: summaryLines.join('\n'),
      primaryLinkUrl: o.primaryLinkUrl || null,
    };
  });

  // Pre-index outcomes by milestoneId for O(1) lookups in milestone aggregation
  const outcomesByMilestone = new Map<string, typeof allOutcomes>();
  for (const o of allOutcomes) {
    if (o.milestoneId) {
      if (!outcomesByMilestone.has(o.milestoneId)) outcomesByMilestone.set(o.milestoneId, []);
      outcomesByMilestone.get(o.milestoneId)!.push(o);
    }
  }

  // Build milestone rows with pre-computed summaries
  const milestoneRows: MilestoneRow[] = allMilestones.map(ms => {
    const msOutcomes = outcomesByMilestone.get(ms.id) || [];
    const scores = msOutcomes.map(o => Number(o.priorityScore));
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return {
      id: ms.id,
      name: ms.name,
      targetDate: ms.targetDate,
      type: ms.type || 'release',
      status: ms.status || 'upcoming',
      outcomeCount: msOutcomes.length,
      avgPriorityScore: Math.round(avg),
      completedCount: msOutcomes.filter(o => o.status === 'completed').length,
    };
  });

  // Build motivation rows grouped by type
  const motivationsByType = new Map<string, MotivationRow[]>();
  for (const type of allTypes) {
    motivationsByType.set(type.name, []);
  }
  // We need outcome titles for context
  const outcomeMap = new Map(allOutcomes.map(o => [o.id, o.title]));
  for (const link of allLinks) {
    const rows = motivationsByType.get(link.motivationType);
    if (rows) {
      rows.push({
        id: link.motivationId,
        title: link.motivationTitle,
        outcomeId: link.outcomeId,
        outcomeTitle: outcomeMap.get(link.outcomeId) || '',
        typeName: link.motivationType,
        score: link.motivationScore,
        status: link.motivationStatus,
        targetDate: link.motivationTargetDate ?? null,
        attributes: (link.motivationAttributes as Record<string, unknown>) || {},
      });
    }
  }

  return { outcomeRows, milestoneRows, motivationsByType, allTypes, milestoneNames: allMilestones.map(m => m.name), sortedTagNames };
}

/** Convert a 1-based column number to an Excel column letter string (1=A, 26=Z, 27=AA, etc.) */
function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// ─── Styles ───

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E7E3' } };
const HEADER_BORDER: Partial<ExcelJS.Borders> = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } };

function applyHeaderStyle(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10 };
    cell.fill = HEADER_FILL;
    cell.border = HEADER_BORDER;
    cell.alignment = { vertical: 'top', wrapText: true };
  });
}

function applyReadOnly(cell: ExcelJS.Cell) {
  cell.protection = { locked: true };
  cell.font = { ...cell.font, color: { argb: 'FF888888' } };
}

function applyEditable(cell: ExcelJS.Cell) {
  cell.protection = { locked: false };
}

// ─── Validation helpers ───

function listValidation(values: readonly string[], prompt: string): ExcelJS.DataValidation {
  return {
    type: 'list',
    formulae: [`"${values.join(',')}"`],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Invalid value',
    error: `Must be one of: ${values.join(', ')}`,
    showInputMessage: true,
    promptTitle: 'Choose',
    prompt,
    errorStyle: 'stop',
  };
}

function textLengthValidation(max: number): ExcelJS.DataValidation {
  return {
    type: 'textLength',
    operator: 'lessThanOrEqual',
    formulae: [max],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Too long',
    error: `Must be ${max.toLocaleString()} characters or fewer`,
    errorStyle: 'stop',
  };
}

function decimalRangeValidation(min: number, max: number, prompt: string): ExcelJS.DataValidation {
  return {
    type: 'decimal',
    operator: 'between',
    formulae: [min, max],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Out of range',
    error: `Must be between ${min} and ${max}`,
    showInputMessage: true,
    promptTitle: 'Range',
    prompt,
    errorStyle: 'stop',
  };
}

function numberMinValidation(min: number, prompt: string): ExcelJS.DataValidation {
  return {
    type: 'decimal',
    operator: 'greaterThanOrEqual',
    formulae: [min],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Out of range',
    error: `Must be ${min} or greater`,
    showInputMessage: true,
    promptTitle: 'Value',
    prompt,
    errorStyle: 'stop',
  };
}

function dateValidation(): ExcelJS.DataValidation {
  return {
    type: 'date',
    operator: 'greaterThanOrEqual',
    formulae: [new Date(2000, 0, 1)],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Invalid date',
    error: 'Enter a valid date',
    errorStyle: 'stop',
  };
}

/** Translate a single JSON Schema property into an ExcelJS DataValidation, or null for freetext. */
function jsonSchemaToValidation(propSchema: Record<string, unknown>, propName: string): ExcelJS.DataValidation | null {
  if (propSchema.enum) {
    return listValidation(propSchema.enum as string[], `Select ${propName.replace(/_/g, ' ')}`);
  }
  if (propSchema.type === 'boolean') {
    return listValidation(['TRUE', 'FALSE'], `TRUE or FALSE`);
  }
  if (propSchema.format === 'date') {
    return dateValidation();
  }
  if (propSchema.type === 'number') {
    const min = typeof propSchema.minimum === 'number' ? propSchema.minimum : undefined;
    const max = typeof propSchema.maximum === 'number' ? propSchema.maximum : undefined;
    if (min !== undefined && max !== undefined) {
      return decimalRangeValidation(min, max, `${min}–${max}`);
    }
    if (min !== undefined) {
      return numberMinValidation(min, `≥ ${min}`);
    }
  }
  return null; // freetext
}

// ─── GET /export/timeline ───

router.get('/timeline', async (_req, res) => {
  const { outcomeRows, milestoneRows, motivationsByType, allTypes, sortedTagNames } = await buildStructuredData();
  const adapter = getAdapter();
  const primaryLinkHeader = adapter?.label ?? 'Primary Issue';

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'moou';
  workbook.created = new Date();

  // ════════════════════════════════════════════
  // Sheet 1: Milestones
  // ════════════════════════════════════════════
  const msSheet = workbook.addWorksheet('Milestones');
  msSheet.columns = [
    { header: 'Milestone ID', key: 'id', width: 14 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Target Date', key: 'targetDate', width: 14 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Outcomes', key: 'outcomeCount', width: 10 },
    { header: 'Avg Score', key: 'avgPriorityScore', width: 10 },
    { header: 'Completed', key: 'completedCount', width: 10 },
  ];
  applyHeaderStyle(msSheet.getRow(1));

  for (const ms of milestoneRows) {
    const row = msSheet.addRow({
      id: sanitizeCell(ms.id),
      name: sanitizeCell(ms.name),
      targetDate: new Date(ms.targetDate),
      type: ms.type,
      status: ms.status,
      outcomeCount: ms.outcomeCount,
      avgPriorityScore: ms.avgPriorityScore,
      completedCount: ms.completedCount,
    });
    row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; });
    // Read-only: ID, summary columns
    applyReadOnly(row.getCell('id'));
    applyReadOnly(row.getCell('outcomeCount'));
    applyReadOnly(row.getCell('avgPriorityScore'));
    applyReadOnly(row.getCell('completedCount'));
    // Editable cells
    for (const key of ['name', 'targetDate', 'type', 'status'] as const) applyEditable(row.getCell(key));
    // Validation
    row.getCell('type').dataValidation = listValidation(VALID_MILESTONE_TYPES, 'Milestone type');
    row.getCell('status').dataValidation = listValidation(VALID_MILESTONE_STATUSES, 'Milestone status');
    row.getCell('targetDate').dataValidation = dateValidation();
    row.getCell('name').dataValidation = textLengthValidation(200);
  }

  msSheet.views = [{ state: 'frozen', ySplit: 1 }];
  msSheet.autoFilter = { from: 'A1', to: `H${milestoneRows.length + 1}` };

  // Define a named range for milestone names (column B, data rows only).
  // Used by Timeline sheet milestone dropdown to avoid Excel's inline list character limit.
  const msLastDataRow = Math.max(milestoneRows.length + 1, 2); // at least row 2 so range is valid
  workbook.definedNames.add(`'Milestones'!$B$2:$B$${msLastDataRow}`, 'MilestoneNames');

  // Protect sheet — only editable cells are unlocked
  await msSheet.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatCells: true, sort: true, autoFilter: true });

  // ════════════════════════════════════════════
  // Sheet 2: Timeline
  // ════════════════════════════════════════════
  const tlSheet = workbook.addWorksheet('Timeline');
  tlSheet.columns = [
    { header: 'Outcome ID', key: 'id', width: 14 },
    { header: 'Outcome', key: 'title', width: 35 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Milestone', key: 'milestone', width: 22 },
    { header: 'Milestone Date', key: 'milestoneDate', width: 14 },
    { header: 'Effort', key: 'effort', width: 8 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Priority Score', key: 'priorityScore', width: 14 },
    { header: 'Tags', key: 'tags', width: 20 },
    { header: primaryLinkHeader, key: 'primaryLinkUrl', width: 30 },
    { header: 'Motivations', key: 'motivationCount', width: 12 },
    { header: 'Top Type', key: 'topMotivationType', width: 18 },
    ...sortedTagNames.map(t => ({ header: `Tag: ${t}`, key: `tag_${t}`, width: 10, hidden: true })),
  ];
  applyHeaderStyle(tlSheet.getRow(1));

  // Milestone dropdown references the named range defined on the Milestones sheet
  const milestoneListValidation: ExcelJS.DataValidation = {
    type: 'list',
    formulae: ['MilestoneNames'],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Unknown milestone',
    error: 'Select a milestone from the Milestones sheet, or leave blank for backlog.',
    showInputMessage: true,
    promptTitle: 'Milestone',
    prompt: 'Select milestone or leave blank',
    errorStyle: 'warning',
  };

  for (const o of outcomeRows) {
    const row = tlSheet.addRow({
      id: sanitizeCell(o.id),
      title: sanitizeCell(o.title),
      description: sanitizeCell(o.description),
      milestone: o.milestoneName || '',
      milestoneDate: null,
      effort: o.effort || '',
      status: o.status,
      priorityScore: Number(o.priorityScore),
      tags: sanitizeCell(o.tags),
      primaryLinkUrl: sanitizeCell(o.primaryLinkUrl || ''),
      motivationCount: o.motivationCount,
      topMotivationType: o.topMotivationType || '',
      ...Object.fromEntries(sortedTagNames.map(t => [`tag_${t}`, o.tagSet.has(t)])),
    });
    row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; });

    // Make primary link a clickable hyperlink (only for safe schemes)
    if (o.primaryLinkUrl && /^https?:\/\//i.test(o.primaryLinkUrl)) {
      const linkCell = row.getCell('primaryLinkUrl');
      linkCell.value = { text: o.primaryLinkUrl, hyperlink: o.primaryLinkUrl } as any;
      linkCell.font = { ...linkCell.font, color: { argb: 'FF2A7AC8' }, underline: true };
    }

    // Milestone Date: VLOOKUP formula against Milestones sheet (col B=Name, col C=Target Date)
    const milestoneDateCell = row.getCell('milestoneDate');
    milestoneDateCell.value = { formula: `IFERROR(VLOOKUP(D${row.number},Milestones!$B:$C,2,FALSE),"")` } as ExcelJS.CellFormulaValue;
    milestoneDateCell.numFmt = 'yyyy-mm-dd';
    applyReadOnly(milestoneDateCell);

    // Read-only cells
    applyReadOnly(row.getCell('id'));
    applyReadOnly(row.getCell('priorityScore'));
    applyReadOnly(row.getCell('primaryLinkUrl'));
    applyReadOnly(row.getCell('motivationCount'));
    applyReadOnly(row.getCell('topMotivationType'));
    for (const t of sortedTagNames) applyReadOnly(row.getCell(`tag_${t}`));

    // Editable cells
    for (const key of ['title', 'description', 'milestone', 'effort', 'status', 'tags'] as const) applyEditable(row.getCell(key));
    // Validation
    row.getCell('milestone').dataValidation = milestoneListValidation;
    row.getCell('effort').dataValidation = listValidation(VALID_EFFORT_SIZES, 'Effort size');
    row.getCell('status').dataValidation = listValidation(VALID_OUTCOME_STATUSES, 'Outcome status');
    row.getCell('title').dataValidation = textLengthValidation(500);
    row.getCell('description').dataValidation = textLengthValidation(50000);

    // Cell comment with motivation summary
    if (o.motivationSummary) {
      row.getCell('motivationCount').note = {
        texts: [{ text: o.motivationSummary, font: { size: 9, name: 'Calibri' } }],
      };
    }
  }

  tlSheet.views = [{ state: 'frozen', ySplit: 1 }];
  const tlLastCol = colLetter(tlSheet.columns.length);
  tlSheet.autoFilter = { from: 'A1', to: `${tlLastCol}${outcomeRows.length + 1}` };
  // Protect sheet — only editable cells are unlocked
  await tlSheet.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatCells: true, sort: true, autoFilter: true });

  // ════════════════════════════════════════════
  // Sheets 3–N: One per motivation type
  // ════════════════════════════════════════════
  for (const type of allTypes) {
    const schema = type.attributeSchema as { properties?: Record<string, Record<string, unknown>> };
    const attrProps = schema.properties || {};
    const attrKeys = Object.keys(attrProps);

    const typeRows = (motivationsByType.get(type.name) || [])
      .slice()
      .sort((a, b) => {
        const da = (a.targetDate ?? '9999') as string;
        const db_ = (b.targetDate ?? '9999') as string;
        return da < db_ ? -1 : da > db_ ? 1 : 0;
      });
    if (typeRows.length === 0) continue; // skip empty types

    // Sheet name sanitisation — shared with import.ts (via safeSheetName from input-validation)
    // so import can find these sheets by applying the same transform to motivation_types.name.
    const sheetName = safeSheetName(type.name);
    const typeSheet = workbook.addWorksheet(sheetName);

    // Build columns: fixed + type-specific attributes
    const typeCols: Partial<ExcelJS.Column>[] = [
      { header: 'Motivation ID', key: 'id', width: 14 },
      { header: 'Motivation', key: 'title', width: 35 },
      { header: 'Outcome', key: 'outcomeTitle', width: 30 },
      { header: 'Outcome ID', key: 'outcomeId', width: 14 },
      { header: 'Score', key: 'score', width: 10 },
      { header: 'Status', key: 'status', width: 12 },
    ];
    for (const key of attrKeys) {
      typeCols.push({ header: key.replace(/_/g, ' '), key: `attr_${key}`, width: 16 });
    }
    typeSheet.columns = typeCols;
    applyHeaderStyle(typeSheet.getRow(1));

    // Build validation map from schema
    const attrValidations = new Map<string, ExcelJS.DataValidation | null>();
    for (const [key, propSchema] of Object.entries(attrProps)) {
      attrValidations.set(key, jsonSchemaToValidation(propSchema, key));
    }

    for (const m of typeRows) {
      const rowData: Record<string, unknown> = {
        id: sanitizeCell(m.id),
        title: sanitizeCell(m.title),
        outcomeTitle: sanitizeCell(m.outcomeTitle),
        outcomeId: sanitizeCell(m.outcomeId),
        score: m.score ? Number(m.score) : null,
        status: m.status,
      };
      for (const key of attrKeys) {
        let val = m.attributes[key] ?? null;
        // Convert date strings to Date objects for Excel
        if (attrProps[key]?.format === 'date' && typeof val === 'string') {
          val = new Date(val);
        }
        // Convert booleans to Excel-friendly strings
        if (attrProps[key]?.type === 'boolean' && typeof val === 'boolean') {
          val = val ? 'TRUE' : 'FALSE';
        }
        rowData[`attr_${key}`] = sanitizeCell(val);
      }

      const row = typeSheet.addRow(rowData);
      row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; });

      // Read-only cells
      applyReadOnly(row.getCell('id'));
      applyReadOnly(row.getCell('outcomeTitle'));
      applyReadOnly(row.getCell('outcomeId'));
      applyReadOnly(row.getCell('score'));

      // Editable cells
      applyEditable(row.getCell('title'));
      applyEditable(row.getCell('status'));
      for (const key of attrKeys) applyEditable(row.getCell(`attr_${key}`));

      // Fixed-column validation
      row.getCell('status').dataValidation = listValidation(['active', 'resolved'], 'Motivation status');
      row.getCell('title').dataValidation = textLengthValidation(500);

      // Attribute validation from schema
      for (const key of attrKeys) {
        const validation = attrValidations.get(key);
        if (validation) {
          row.getCell(`attr_${key}`).dataValidation = validation;
        }
      }
    }

    const typeLastCol = colLetter(typeSheet.columns.length);
    typeSheet.views = [{ state: 'frozen', ySplit: 1 }];
    typeSheet.autoFilter = { from: 'A1', to: `${typeLastCol}${typeRows.length + 1}` };
    await typeSheet.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatCells: true, sort: true, autoFilter: true });
  }

  // ─── Send response ───
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="timeline-${new Date().toISOString().split('T')[0]}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

// ─── GET /export/timeline/markdown ───

router.get('/timeline/markdown', async (_req, res) => {
  const { outcomeRows, milestoneRows, motivationsByType } = await buildStructuredData();

  // Group outcomes by milestone for markdown
  const groups = new Map<string, OutcomeRow[]>();
  for (const o of outcomeRows) {
    const key = o.milestoneName || 'Backlog';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  let md = `# moou Timeline Export\n\n*Exported ${new Date().toISOString().split('T')[0]}*\n\n`;

  for (const [milestone, milestoneOutcomes] of groups) {
    md += `## ${escapeMarkdown(milestone)}\n\n`;

    for (const o of milestoneOutcomes) {
      const score = Number(o.priorityScore).toLocaleString('en', { maximumFractionDigits: 0 });
      md += `### ${escapeMarkdown(o.title)}\n`;
      md += `**Score:** ${score} | **Effort:** ${escapeMarkdown(o.effort) || '—'} | **Status:** ${escapeMarkdown(o.status)}`;
      if (o.tags) md += ` | **Tags:** ${escapeMarkdown(o.tags)}`;
      md += `\n\n`;
      if (o.description) md += `${escapeMarkdownBlock(o.description)}\n\n`;

      if (o.motivationSummary) {
        md += `**Motivations:**\n`;
        for (const line of o.motivationSummary.split('\n')) {
          md += `- ${escapeMarkdown(line)}\n`;
        }
        md += `\n`;
      }
    }
  }

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="timeline-${new Date().toISOString().split('T')[0]}.md"`);
  res.send(md);
});

// ─── GET /export/timeline/pptx ───

// Colour palette
const BRAND = {
  dark: '2d2d2d',
  accent: '4a7c59',
  accentLight: 'e8f0eb',
  muted: '888888',
  headerBg: 'e8e7e3',
  white: 'ffffff',
  customerBg: 'eef4f9',
  complianceBg: 'f5eef9',
  mandateBg: 'fef8ee',
  techDebtBg: 'feeeee',
  competitiveBg: 'eef9f5',
};

// Chart colors per motivation type
const TYPE_COLORS: Record<string, string> = {
  'Customer Demand': '4a90c4',
  'Tech Debt': 'c44a4a',
  'Compliance': '8a4ac4',
  'Competitive Gap': '4ac48a',
  'Internal Mandate': 'c4914a',
};

/** Parse a date-only string (YYYY-MM-DD) to UTC midnight for DST-safe day math. */
function parseDateUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('T')[0].split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Get today as UTC midnight for consistent day-difference calculations. */
function todayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function formatScore(s: string | number | null): string {
  return Number(s || 0).toLocaleString('en', { maximumFractionDigits: 0 });
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
}

function statusColor(status: string): string {
  if (status === 'completed') return '2d8a4e';
  if (status === 'active') return 'c49a1a';
  return 'aaaaaa';
}

/** Group customer motivations by name and sort by total revenue at risk descending. */
function groupCustomersByRevenue(motivations: MotivationRow[]): [string, MotivationRow[]][] {
  const byCustomer = new Map<string, MotivationRow[]>();
  for (const m of motivations) {
    const name = (m.attributes.customer_name as string) || 'Unknown';
    if (!byCustomer.has(name)) byCustomer.set(name, []);
    byCustomer.get(name)!.push(m);
  }
  return [...byCustomer.entries()].sort((a, b) => {
    const revA = a[1].reduce((sum, m) => sum + Number(m.attributes.revenue_at_risk || 0), 0);
    const revB = b[1].reduce((sum, m) => sum + Number(m.attributes.revenue_at_risk || 0), 0);
    return revB - revA;
  });
}

function addSectionDivider(pres: any, title: string, subtitle: string, bgColor: string) {
  const slide = pres.addSlide();
  slide.background = { color: bgColor };
  slide.addText(title, { x: 0.8, y: 1.8, w: 11.7, h: 1.2, fontSize: 32, fontFace: 'Arial', color: BRAND.dark, bold: true });
  slide.addText(subtitle, { x: 0.8, y: 3.0, w: 11.7, h: 0.6, fontSize: 14, fontFace: 'Arial', color: BRAND.muted });
}

function addKpiCard(slide: any, opts: {
  x: number; y: number; w: number; h: number;
  bgColor: string; value: string; label: string; sublabel?: string;
}) {
  slide.addShape('roundRect', {
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    fill: { color: opts.bgColor },
    rectRadius: 0.05,
    line: { color: 'dddddd', width: 0.5 },
  });
  slide.addText(opts.value, {
    x: opts.x, y: opts.y + 0.3, w: opts.w, h: 1.0,
    fontSize: 36, fontFace: 'Arial', color: BRAND.dark, bold: true, align: 'center', valign: 'middle',
  });
  slide.addText(opts.label, {
    x: opts.x, y: opts.y + 1.4, w: opts.w, h: 0.5,
    fontSize: 13, fontFace: 'Arial', color: BRAND.muted, align: 'center', valign: 'top',
  });
  if (opts.sublabel) {
    slide.addText(opts.sublabel, {
      x: opts.x, y: opts.y + 1.85, w: opts.w, h: 0.4,
      fontSize: 10, fontFace: 'Arial', color: BRAND.muted, align: 'center', valign: 'top',
    });
  }
}

// Standard table header cell
function th(text: string) {
  return { text, options: { bold: true, fontSize: 10, color: BRAND.dark, fill: { color: BRAND.headerBg } } };
}
function td(text: string, opts?: Record<string, unknown>) {
  return { text, options: { fontSize: 9, color: BRAND.dark, ...opts } };
}

interface ExecMetrics {
  totalRevenueAtRisk: number;
  totalRevenueOpportunity: number;
  totalLegalExposure: number;
  outcomesTotal: number;
  outcomesCompleted: number;
  outcomesOnTrack: number;
  backlogCount: number;
  nearestComplianceDeadline: string | null;
  complianceDaysUntil: number | null;
  complianceRegulation: string | null;
  techDebtIncidentsTotal: number;
  typeScores: Map<string, number>;
}

export function computeExecMetrics(
  outcomeRows: OutcomeRow[],
  motivationsByType: Map<string, MotivationRow[]>,
): ExecMetrics {
  const today = todayUTC();

  // Revenue & legal metrics from motivations
  let totalRevenueAtRisk = 0;
  let totalRevenueOpportunity = 0;
  let totalLegalExposure = 0;
  let techDebtIncidentsTotal = 0;
  let nearestComplianceDeadline: string | null = null;
  let complianceDaysUntil: number | null = null;
  let complianceRegulation: string | null = null;

  for (const m of motivationsByType.get('Customer Demand') || []) {
    totalRevenueAtRisk += Number(m.attributes.revenue_at_risk || 0);
    totalRevenueOpportunity += Number(m.attributes.revenue_opportunity || 0);
  }
  for (const m of motivationsByType.get('Compliance') || []) {
    totalLegalExposure += Number(m.attributes.legal_exposure || 0);
    const deadline = m.attributes.mandate_deadline as string | undefined;
    if (deadline) {
      const d = parseDateUTC(deadline);
      const days = Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
      // Prefer nearest future deadline; fall back to most-recent overdue if no future exists
      const isBetter = complianceDaysUntil === null
        || (days >= 0 && (complianceDaysUntil < 0 || days < complianceDaysUntil))
        || (days < 0 && complianceDaysUntil < 0 && days > complianceDaysUntil);
      if (isBetter) {
        complianceDaysUntil = days;
        nearestComplianceDeadline = deadline;
        complianceRegulation = (m.attributes.regulation as string) || null;
      }
    }
  }
  for (const m of motivationsByType.get('Tech Debt') || []) {
    techDebtIncidentsTotal += Number(m.attributes.incident_frequency || 0);
  }

  // Outcome metrics
  const outcomesTotal = outcomeRows.length;
  const outcomesCompleted = outcomeRows.filter(o => o.status === 'completed').length;
  const outcomesOnTrack = outcomeRows.filter(o => o.status === 'active' || o.status === 'approved').length;
  const backlogCount = outcomeRows.filter(o => !o.milestoneId).length;

  // Score totals by motivation type
  const typeScores = new Map<string, number>();
  for (const [typeName, mots] of motivationsByType) {
    typeScores.set(typeName, mots.reduce((sum, m) => sum + Number(m.score || 0), 0));
  }

  return {
    totalRevenueAtRisk, totalRevenueOpportunity, totalLegalExposure,
    outcomesTotal, outcomesCompleted, outcomesOnTrack, backlogCount,
    nearestComplianceDeadline, complianceDaysUntil, complianceRegulation,
    techDebtIncidentsTotal, typeScores,
  };
}

router.get('/timeline/pptx', async (_req, res) => {
  const { outcomeRows, milestoneRows, motivationsByType } = await buildStructuredData();

  const pres = new PptxGenJS();
  pres.author = 'moou';
  pres.title = 'Product Roadmap';
  pres.layout = 'LAYOUT_WIDE'; // 13.33" × 7.5"

  const dateStr = new Date().toISOString().split('T')[0];
  const metrics = computeExecMetrics(outcomeRows, motivationsByType);

  // ─── Empty-data guard ───
  const allMotivations = [...motivationsByType.values()].flat();
  if (outcomeRows.length === 0 && allMotivations.length === 0) {
    const titleSlide2 = pres.addSlide();
    titleSlide2.background = { color: BRAND.dark };
    titleSlide2.addText('Product Roadmap', { x: 0.8, y: 1.5, w: 11.7, h: 1.5, fontSize: 40, fontFace: 'Arial', color: BRAND.white, bold: true });
    titleSlide2.addText(`Generated ${dateStr}  ·  moou`, { x: 0.8, y: 3.2, w: 11.7, h: 0.5, fontSize: 14, fontFace: 'Arial', color: BRAND.muted });
    const emptySlide = pres.addSlide();
    emptySlide.addText('No data yet', { x: 0.8, y: 2.0, w: 11.7, h: 1.0, fontSize: 32, fontFace: 'Arial', color: BRAND.dark, bold: true, align: 'center' });
    emptySlide.addText('Add outcomes and motivations to generate your roadmap', {
      x: 0.8, y: 3.2, w: 11.7, h: 0.5, fontSize: 14, fontFace: 'Arial', color: BRAND.muted, align: 'center',
    });
    const buffer = await pres.write({ outputType: 'nodebuffer' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="roadmap-${dateStr}.pptx"`);
    res.send(buffer);
    return;
  }

  // ═══════════════════════════════════════════════
  // SLIDE 1: Title
  // ═══════════════════════════════════════════════
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: BRAND.dark };
  titleSlide.addText('Product Roadmap', { x: 0.8, y: 1.5, w: 11.7, h: 1.5, fontSize: 40, fontFace: 'Arial', color: BRAND.white, bold: true });
  titleSlide.addText(`Generated ${dateStr}  ·  moou`, { x: 0.8, y: 3.2, w: 11.7, h: 0.5, fontSize: 14, fontFace: 'Arial', color: BRAND.muted });

  // ═══════════════════════════════════════════════
  // SLIDE 2: Executive Summary — 4 KPI cards
  // ═══════════════════════════════════════════════
  {
    const slide = pres.addSlide();
    slide.addText('Executive Summary', { x: 0.8, y: 0.3, w: 11.7, h: 0.6, fontSize: 24, fontFace: 'Arial', color: BRAND.dark, bold: true });

    const cardW = 5.5;
    const cardH = 2.4;
    const gapX = 0.5;
    const gapY = 0.4;
    const startX = (13.33 - 2 * cardW - gapX) / 2;
    const startY = 1.2;

    // Card 1: Revenue at Risk (top-left)
    const customerDemands = motivationsByType.get('Customer Demand') || [];
    const revenuePopulated = customerDemands.filter(m => m.attributes.revenue_at_risk != null).length;
    const revenueCompleteness = customerDemands.length > 0 ? revenuePopulated / customerDemands.length : 0;
    let revSublabel: string;
    if (customerDemands.length === 0) {
      revSublabel = '(no customer demands)';
    } else if (revenueCompleteness < 0.5) {
      revSublabel = `(${Math.round(revenueCompleteness * 100)}% of demands have revenue data)`;
    } else {
      revSublabel = `across ${customerDemands.length} customer demands`;
    }
    addKpiCard(slide, {
      x: startX, y: startY, w: cardW, h: cardH,
      bgColor: 'fef2f2', value: formatCurrency(metrics.totalRevenueAtRisk),
      label: 'Revenue at Risk',
      sublabel: revSublabel,
    });

    // Card 2: On Track % (top-right)
    const onTrackPct = metrics.outcomesTotal > 0 ? Math.round((metrics.outcomesOnTrack / metrics.outcomesTotal) * 100) : 0;
    const onTrackColor = onTrackPct >= 70 ? 'f0fdf4' : onTrackPct >= 40 ? 'fefce8' : 'fef2f2';
    addKpiCard(slide, {
      x: startX + cardW + gapX, y: startY, w: cardW, h: cardH,
      bgColor: onTrackColor, value: `${onTrackPct}%`,
      label: 'Outcomes On Track',
      sublabel: `${metrics.outcomesOnTrack} active/approved of ${metrics.outcomesTotal} total  ·  ${metrics.outcomesCompleted} completed`,
    });

    // Card 3: Compliance Deadline (bottom-left)
    const complianceValue = metrics.complianceDaysUntil !== null
      ? (metrics.complianceDaysUntil < 0 ? `${Math.abs(metrics.complianceDaysUntil)}d` : `${metrics.complianceDaysUntil}d`)
      : 'None';
    const complianceLabel = metrics.complianceDaysUntil === null
      ? 'Compliance Deadline'
      : (metrics.complianceDaysUntil < 0 ? 'Days Overdue' : 'Until Next Deadline');
    const complianceBg = metrics.complianceDaysUntil !== null && metrics.complianceDaysUntil <= 30 ? 'faf5ff' : 'f8fafc';
    addKpiCard(slide, {
      x: startX, y: startY + cardH + gapY, w: cardW, h: cardH,
      bgColor: complianceBg, value: complianceValue,
      label: complianceLabel,
      sublabel: metrics.complianceRegulation ? truncate(metrics.complianceRegulation, 40) : undefined,
    });

    // Card 4: Backlog (bottom-right)
    addKpiCard(slide, {
      x: startX + cardW + gapX, y: startY + cardH + gapY, w: cardW, h: cardH,
      bgColor: 'f8fafc', value: String(metrics.backlogCount),
      label: 'Unassigned to Milestone',
      sublabel: metrics.backlogCount > 0 ? 'outcomes in backlog without delivery date' : 'all outcomes are planned',
    });
  }

  // ═══════════════════════════════════════════════
  // SLIDE 3: Portfolio Balance — Doughnut chart
  // ═══════════════════════════════════════════════
  {
    const typeLabels: string[] = [];
    const typeValues: number[] = [];
    const typeColors: string[] = [];
    // Sort by score descending for deterministic chart order regardless of DB row order
    const sortedTypeScores = [...metrics.typeScores.entries()].sort((a, b) => b[1] - a[1]);
    for (const [typeName, totalScore] of sortedTypeScores) {
      if (totalScore > 0) {
        typeLabels.push(typeName);
        typeValues.push(totalScore);
        typeColors.push(TYPE_COLORS[typeName] || BRAND.muted);
      }
    }

    if (typeLabels.length > 0) {
      const slide = pres.addSlide();
      slide.addText('Where Priority Weight Concentrates', { x: 0.8, y: 0.3, w: 11.7, h: 0.6, fontSize: 24, fontFace: 'Arial', color: BRAND.dark, bold: true });

      // Annotation: dominant type
      const totalAll = typeValues.reduce((a, b) => a + b, 0);
      const maxIdx = typeValues.indexOf(Math.max(...typeValues));
      const dominantPct = Math.round((typeValues[maxIdx] / totalAll) * 100);
      slide.addText(`${typeLabels[maxIdx]} accounts for ${dominantPct}% of priority weight`, {
        x: 0.8, y: 0.9, w: 11.7, h: 0.4, fontSize: 12, fontFace: 'Arial', color: BRAND.muted,
      });

      slide.addChart('doughnut', [{ labels: typeLabels, values: typeValues }], {
        x: 2.5, y: 1.5, w: 8, h: 5.5,
        holeSize: 50,
        showPercent: true,
        showLabel: true,
        dataLabelPosition: 'outEnd',
        dataLabelFontSize: 11,
        chartColors: typeColors,
        showLegend: true,
        legendPos: 'b',
        legendFontSize: 11,
      });
    }
  }

  // ═══════════════════════════════════════════════
  // ACT 2: Customer Impact
  // ═══════════════════════════════════════════════
  const customerMotivations = motivationsByType.get('Customer Demand') || [];

  if (customerMotivations.length > 0) {
    addSectionDivider(pres, 'Customer Impact', 'Revenue-linked outcomes prioritised by customer impact', BRAND.customerBg);

    const sortedCustomers = groupCustomersByRevenue(customerMotivations);

    // ─── Bar chart: Top 5 customers by revenue at risk ───
    const top5 = sortedCustomers.slice(0, 5);
    if (top5.length > 0) {
      const slide = pres.addSlide();
      slide.addText('Top Customers by Revenue at Risk', { x: 0.5, y: 0.3, w: 11.7, h: 0.6, fontSize: 24, fontFace: 'Arial', color: BRAND.dark, bold: true });
      slide.addText(`${formatCurrency(metrics.totalRevenueAtRisk)} total across ${sortedCustomers.length} customers`, {
        x: 0.5, y: 0.9, w: 11.7, h: 0.4, fontSize: 12, fontFace: 'Arial', color: BRAND.muted,
      });

      const barLabels = top5.map(([name]) => truncate(name, 25));
      const barValues = top5.map(([, mots]) => mots.reduce((s, m) => s + Number(m.attributes.revenue_at_risk || 0), 0));

      slide.addChart('bar', [{ labels: barLabels, values: barValues }], {
        x: 0.5, y: 1.5, w: 12, h: 5.5,
        barDir: 'bar',
        barGapWidthPct: 80,
        chartColors: ['4a90c4', '5ba0d4', '6cb0e4', '7dc0f0', '8ed0ff'],
        showValue: true,
        dataLabelPosition: 'outEnd',
        dataLabelFontSize: 11,
        dataLabelFormatCode: '$#,##0',
        catAxisOrientation: 'maxMin',
        valAxisHidden: true,
        catAxisFontSize: 12,
        showLegend: false,
      });
    }

    // ─── Top 3 customer detail slides ───
    const top3 = sortedCustomers.slice(0, 3);
    for (const [customerName, mots] of top3) {
      const slide = pres.addSlide();
      const totalRev = mots.reduce((sum, m) => sum + Number(m.attributes.revenue_at_risk || 0), 0);
      const totalOpp = mots.reduce((sum, m) => sum + Number(m.attributes.revenue_opportunity || 0), 0);
      const segment = (mots[0]?.attributes.segment as string) || '';
      const dealStage = (mots[0]?.attributes.deal_stage as string) || '';

      slide.addText(customerName, { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 24, fontFace: 'Arial', color: BRAND.dark, bold: true });

      const badges = [
        segment ? segment.charAt(0).toUpperCase() + segment.slice(1) : null,
        dealStage ? `Deal: ${dealStage}` : null,
        totalRev ? `Revenue at risk: ${formatCurrency(totalRev)}` : null,
        totalOpp ? `Opportunity: ${formatCurrency(totalOpp)}` : null,
      ].filter(Boolean).join('  ·  ');
      slide.addText(badges, { x: 0.5, y: 0.9, w: 12, h: 0.4, fontSize: 11, fontFace: 'Arial', color: BRAND.muted });

      // Cap at 5 rows
      const topMots = mots.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 5);
      const dataRows = topMots.map(m => [
        td(truncate(m.outcomeTitle, 35)),
        td(truncate(m.title, 30)),
        td((m.attributes.impact_type as string) || '\u2014'),
        td(m.attributes.confidence != null ? `${Math.round(Number(m.attributes.confidence) * 100)}%` : '\u2014'),
        td(m.targetDate || '\u2014'),
        td(formatScore(m.score), { bold: true }),
      ]);

      slide.addTable([
        [th('Outcome'), th('Motivation'), th('Impact'), th('Confidence'), th('Target'), th('Score')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.5, w: 12.3,
        colW: [3.0, 3.0, 1.2, 1.2, 1.2, 1.0],
        border: { type: 'solid', pt: 0.5, color: 'cccccc' },
        rowH: 0.35,
      });

      if (mots.length > 5) {
        slide.addText(`+ ${mots.length - 5} more in appendix`, {
          x: 0.5, y: 6.8, w: 12, h: 0.3, fontSize: 10, fontFace: 'Arial', color: BRAND.muted,
        });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // ACT 3: Delivery Timeline
  // ═══════════════════════════════════════════════
  addSectionDivider(pres, 'Delivery Timeline', 'Milestones and outcomes sorted by priority', BRAND.white);

  // ─── Timeline overview (Gantt-style markers) ───
  {
    const today = todayUTC();

    // Include non-completed milestones (active ones with past dates are shown as overdue), cap at 8
    const futureMilestones = milestoneRows
      .filter(ms => ms.status !== 'completed')
      .slice(0, 8);

    if (futureMilestones.length > 0) {
      const slide = pres.addSlide();
      slide.addText('Timeline Overview', { x: 0.5, y: 0.3, w: 11.7, h: 0.6, fontSize: 24, fontFace: 'Arial', color: BRAND.dark, bold: true });

      const dates = futureMilestones.map(ms => parseDateUTC(ms.targetDate));
      const minDate = today;
      const maxDate = new Date(Math.max(...dates.map(d => d.getTime()), today.getTime() + 30 * 86_400_000));
      const totalDays = Math.max((maxDate.getTime() - minDate.getTime()) / 86_400_000, 1);

      const tlLeft = 3.0;
      const tlWidth = 9.5;
      const barH = 0.45;
      const barGap = 0.15;
      const barW = 1.5;
      const startY = 1.6;

      // Month markers along top
      const monthCursor = new Date(minDate);
      monthCursor.setUTCDate(1);
      monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
      while (monthCursor <= maxDate) {
        const dayOffset = (monthCursor.getTime() - minDate.getTime()) / 86_400_000;
        const x = tlLeft + (dayOffset / totalDays) * tlWidth;
        if (x >= tlLeft && x <= tlLeft + tlWidth) {
          slide.addText(monthCursor.toLocaleDateString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }), {
            x: x - 0.4, y: 1.15, w: 0.8, h: 0.3, fontSize: 8, fontFace: 'Arial', color: BRAND.muted, align: 'center',
          });
          // Tick line
          slide.addShape('line', { x, y: 1.45, w: 0, h: startY + futureMilestones.length * (barH + barGap) - 1.45, line: { color: 'eeeeee', width: 0.5 } });
        }
        monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
      }

      // "Today" marker
      slide.addShape('line', {
        x: tlLeft, y: 1.45, w: 0,
        h: startY + futureMilestones.length * (barH + barGap) - 1.45,
        line: { color: 'cc3333', width: 1, dashType: 'dash' },
      });
      slide.addText('Today', {
        x: tlLeft - 0.5, y: 1.15, w: 1.0, h: 0.3, fontSize: 8, fontFace: 'Arial', color: 'cc3333', align: 'center',
      });

      for (let i = 0; i < futureMilestones.length; i++) {
        const ms = futureMilestones[i];
        const msDate = parseDateUTC(ms.targetDate);
        const dayOffset = (msDate.getTime() - minDate.getTime()) / 86_400_000;
        let markerX = tlLeft + (dayOffset / totalDays) * tlWidth - barW / 2;
        // Clamp to slide bounds
        markerX = Math.max(tlLeft, Math.min(markerX, tlLeft + tlWidth - barW));
        const y = startY + i * (barH + barGap);

        // Label on left
        slide.addText(truncate(ms.name, 25), {
          x: 0.3, y, w: 2.5, h: barH,
          fontSize: 10, fontFace: 'Arial', color: BRAND.dark, align: 'right', valign: 'middle',
        });

        // Bar
        const color = statusColor(ms.status);
        slide.addShape('roundRect', {
          x: markerX, y, w: barW, h: barH,
          fill: { color }, rectRadius: 0.05,
        });

        // Date + count on bar
        const completionPct = ms.outcomeCount > 0 ? Math.round((ms.completedCount / ms.outcomeCount) * 100) : 0;
        slide.addText(`${ms.targetDate}  ·  ${ms.outcomeCount} outcomes  ·  ${completionPct}%`, {
          x: markerX, y, w: barW, h: barH,
          fontSize: 7, fontFace: 'Arial', color: BRAND.white, align: 'center', valign: 'middle',
        });
      }

      const remaining = milestoneRows.filter(ms => ms.status !== 'completed').length - futureMilestones.length;
      if (remaining > 0) {
        slide.addText(`+ ${remaining} more milestones in appendix`, {
          x: 0.5, y: startY + futureMilestones.length * (barH + barGap) + 0.2, w: 12, h: 0.3,
          fontSize: 10, fontFace: 'Arial', color: BRAND.muted,
        });
      }
    } else if (milestoneRows.length > 0) {
      // All milestones completed — show summary list
      const slide = pres.addSlide();
      slide.addText('Completed Milestones', { x: 0.5, y: 0.3, w: 11.7, h: 0.6, fontSize: 24, fontFace: 'Arial', color: BRAND.dark, bold: true });
      slide.addText('All milestones are completed', { x: 0.5, y: 0.9, w: 11.7, h: 0.4, fontSize: 12, fontFace: 'Arial', color: BRAND.muted });

      const rows = milestoneRows.slice(0, 10).map(ms => [
        td(ms.name), td(ms.targetDate), td(`${ms.outcomeCount} outcomes`), td(`${ms.completedCount} done`),
      ]);
      slide.addTable([
        [th('Milestone'), th('Date'), th('Outcomes'), th('Completed')],
        ...rows,
      ], { x: 0.5, y: 1.5, w: 12.3, colW: [5, 2, 2.5, 2.8], border: { type: 'solid', pt: 0.5, color: 'cccccc' }, rowH: 0.35 });
    }
  }

  // ─── Milestone deep dives (next 2 upcoming/active) ───
  {
    // Group outcomes by milestone
    const outcomesByMs = new Map<string, OutcomeRow[]>();
    for (const o of outcomeRows) {
      if (o.milestoneName) {
        if (!outcomesByMs.has(o.milestoneName)) outcomesByMs.set(o.milestoneName, []);
        outcomesByMs.get(o.milestoneName)!.push(o);
      }
    }

    const upcomingMs = milestoneRows
      .filter(ms => ms.status === 'upcoming' || ms.status === 'active')
      .slice(0, 2);

    for (const ms of upcomingMs) {
      const msOutcomes = (outcomesByMs.get(ms.name) || [])
        .slice().sort((a, b) => Number(b.priorityScore) - Number(a.priorityScore))
        .slice(0, 5);

      if (msOutcomes.length === 0) continue;

      const slide = pres.addSlide();
      const completionPct = ms.outcomeCount > 0 ? Math.round((ms.completedCount / ms.outcomeCount) * 100) : 0;

      slide.addText(ms.name, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 24, fontFace: 'Arial', color: BRAND.dark, bold: true });
      slide.addText(`${ms.targetDate}  ·  ${ms.type}  ·  ${ms.outcomeCount} outcomes  ·  ${completionPct}% complete`, {
        x: 0.5, y: 0.9, w: 12, h: 0.4, fontSize: 11, fontFace: 'Arial', color: BRAND.muted,
      });

      // Progress bar
      const barX = 0.5, barY = 1.4, barW2 = 12.3, barH2 = 0.15;
      slide.addShape('rect', { x: barX, y: barY, w: barW2, h: barH2, fill: { color: 'eeeeee' } });
      if (completionPct > 0) {
        slide.addShape('rect', { x: barX, y: barY, w: barW2 * (completionPct / 100), h: barH2, fill: { color: '2d8a4e' } });
      }

      const dataRows = msOutcomes.map(o => [
        td(truncate(o.title, 40)),
        td(o.effort || '\u2014'),
        td(o.status),
        td(formatScore(o.priorityScore), { bold: true }),
        td(o.topMotivationType || '\u2014', { color: BRAND.muted }),
      ]);

      slide.addTable([
        [th('Outcome'), th('Effort'), th('Status'), th('Score'), th('Top Motivation')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.8, w: 12.3,
        colW: [4.5, 1.0, 1.5, 1.2, 3.0],
        border: { type: 'solid', pt: 0.5, color: 'cccccc' },
        rowH: 0.35,
      });

      const totalMsOutcomes = (outcomesByMs.get(ms.name) || []).length;
      if (totalMsOutcomes > 5) {
        slide.addText(`Top 5 of ${totalMsOutcomes} outcomes by priority score — see appendix for full list`, {
          x: 0.5, y: 6.8, w: 12, h: 0.3, fontSize: 10, fontFace: 'Arial', color: BRAND.muted,
        });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // ACT 4: Risks & Engineering
  // ═══════════════════════════════════════════════
  const techDebtMotivations = motivationsByType.get('Tech Debt') || [];
  const complianceMotivations = motivationsByType.get('Compliance') || [];
  const competitiveMotivations = motivationsByType.get('Competitive Gap') || [];

  const hasRiskSection = techDebtMotivations.length > 0 || complianceMotivations.length > 0 || competitiveMotivations.length > 0;

  if (hasRiskSection) {
    addSectionDivider(pres, 'Risks & Engineering', 'Compliance deadlines, tech debt, and competitive pressure', BRAND.techDebtBg);

    // ─── Risk cards (3-column layout) ───
    {
      const slide = pres.addSlide();
      slide.addText('Top Risks', { x: 0.5, y: 0.3, w: 11.7, h: 0.6, fontSize: 24, fontFace: 'Arial', color: BRAND.dark, bold: true });

      const cards: { color: string; title: string; metric: string; detail1: string; detail2: string }[] = [];

      // Compliance card — use metrics which already track the nearest deadline
      if (complianceMotivations.length > 0) {
        const compMetric = metrics.complianceDaysUntil !== null
          ? (metrics.complianceDaysUntil < 0 ? `Overdue ${Math.abs(metrics.complianceDaysUntil)}d` : `${metrics.complianceDaysUntil} days`)
          : 'No deadline';
        cards.push({
          color: '8a4ac4',
          title: 'Compliance',
          metric: compMetric,
          detail1: metrics.complianceRegulation ? truncate(metrics.complianceRegulation, 35) : '',
          detail2: metrics.totalLegalExposure > 0 ? `Legal exposure: ${formatCurrency(metrics.totalLegalExposure)}` : '',
        });
      }

      // Tech Debt card
      if (techDebtMotivations.length > 0) {
        const topTD = techDebtMotivations.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
        cards.push({
          color: 'c44a4a',
          title: 'Tech Debt',
          metric: `${metrics.techDebtIncidentsTotal} incidents/mo`,
          detail1: truncate(topTD.title, 35),
          detail2: `Blast radius: ${(topTD.attributes.blast_radius as string) || 'unknown'}`,
        });
      }

      // Competitive card
      if (competitiveMotivations.length > 0) {
        const topComp = competitiveMotivations.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0];
        const totalDeals = competitiveMotivations.reduce((s, m) => s + Number(m.attributes.deals_lost || 0), 0);
        cards.push({
          color: '4ac48a',
          title: 'Competitive Gaps',
          metric: totalDeals > 0 ? `${totalDeals} deals lost` : `${competitiveMotivations.length} gaps`,
          detail1: `Top: ${truncate((topComp.attributes.competitor as string) || 'Unknown', 25)}`,
          detail2: `Severity: ${(topComp.attributes.gap_severity as string) || 'unknown'}`,
        });
      }

      const cardCount = cards.length;
      const cardW = 3.5;
      const gap = 0.5;
      const totalW = cardCount * cardW + (cardCount - 1) * gap;
      const offsetX = (13.33 - totalW) / 2;

      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        const x = offsetX + i * (cardW + gap);
        const y = 1.3;
        const h = 4.5;

        // Color bar at top
        slide.addShape('rect', { x, y, w: cardW, h: 0.08, fill: { color: c.color } });

        // Card background
        slide.addShape('roundRect', { x, y: y + 0.08, w: cardW, h: h - 0.08, fill: { color: 'fafafa' }, rectRadius: 0.03, line: { color: 'eeeeee', width: 0.5 } });

        // Title
        slide.addText(c.title, { x, y: y + 0.3, w: cardW, h: 0.5, fontSize: 14, fontFace: 'Arial', color: c.color, bold: true, align: 'center' });

        // Big metric
        slide.addText(c.metric, { x, y: y + 1.0, w: cardW, h: 1.2, fontSize: 28, fontFace: 'Arial', color: BRAND.dark, bold: true, align: 'center', valign: 'middle' });

        // Detail lines
        slide.addText(c.detail1, { x: x + 0.2, y: y + 2.5, w: cardW - 0.4, h: 0.5, fontSize: 11, fontFace: 'Arial', color: BRAND.dark, align: 'center' });
        slide.addText(c.detail2, { x: x + 0.2, y: y + 3.1, w: cardW - 0.4, h: 0.5, fontSize: 11, fontFace: 'Arial', color: BRAND.muted, align: 'center' });
      }
    }

    // ─── Tech Debt bar chart (only if >2 items) ───
    if (techDebtMotivations.length > 2) {
      const sorted = techDebtMotivations.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      const slide = pres.addSlide();
      slide.addText('Tech Debt by Priority Score', { x: 0.5, y: 0.3, w: 11.7, h: 0.6, fontSize: 24, fontFace: 'Arial', color: BRAND.dark, bold: true });
      slide.addText(`${techDebtMotivations.length} items  ·  ${metrics.techDebtIncidentsTotal} total incidents/month`, {
        x: 0.5, y: 0.9, w: 11.7, h: 0.4, fontSize: 12, fontFace: 'Arial', color: BRAND.muted,
      });

      slide.addChart('bar', [{
        labels: sorted.map(m => truncate(m.title, 30)),
        values: sorted.map(m => Number(m.score || 0)),
      }], {
        x: 0.5, y: 1.5, w: 12, h: 5.5,
        barDir: 'bar',
        barGapWidthPct: 60,
        chartColors: ['c44a4a'],
        showValue: true,
        dataLabelPosition: 'outEnd',
        dataLabelFontSize: 10,
        catAxisOrientation: 'maxMin',
        valAxisHidden: true,
        catAxisFontSize: 10,
        showLegend: false,
      });
    }
  }

  // ═══════════════════════════════════════════════
  // ACT 5: Needs Decision
  // ═══════════════════════════════════════════════
  {
    const decisions: { title: string; detail: string; recommendation: string }[] = [];
    const outcomesById = new Map(outcomeRows.map(o => [o.id, o]));

    // 1. Compliance vs Delivery: compliance deadline before its outcome's milestone date
    for (const m of complianceMotivations) {
      const deadline = m.attributes.mandate_deadline as string | undefined;
      if (!deadline) continue;
      const outcome = outcomesById.get(m.outcomeId);
      if (!outcome?.milestoneDate) continue;
      const deadlineDate = parseDateUTC(deadline);
      const milestoneDate = parseDateUTC(outcome.milestoneDate);
      if (deadlineDate < milestoneDate) {
        decisions.push({
          title: `Compliance deadline before delivery`,
          detail: `"${truncate(m.title, 40)}" deadline is ${deadline}, but milestone "${truncate(outcome.milestoneName || '', 25)}" targets ${outcome.milestoneDate}`,
          recommendation: 'Pull the milestone forward or split the outcome',
        });
        break; // One is enough for the slide
      }
    }

    // 2. Overloaded milestone: highest outcome count with lowest completion %
    if (milestoneRows.length > 0) {
      const activeMilestones = milestoneRows.filter(ms => ms.status !== 'completed' && ms.outcomeCount > 0);
      if (activeMilestones.length > 0) {
        const worst = activeMilestones.slice().sort((a, b) => {
          const pctA = a.completedCount / a.outcomeCount;
          const pctB = b.completedCount / b.outcomeCount;
          // Prefer milestones that are both large and behind
          return (pctA - a.outcomeCount * 0.01) - (pctB - b.outcomeCount * 0.01);
        })[0];
        const pct = Math.round((worst.completedCount / worst.outcomeCount) * 100);
        if (pct < 50 && worst.outcomeCount >= 3) {
          decisions.push({
            title: `Overloaded milestone`,
            detail: `"${truncate(worst.name, 30)}" has ${worst.outcomeCount} outcomes but only ${pct}% complete (target: ${worst.targetDate})`,
            recommendation: 'Reduce scope or extend the target date',
          });
        }
      }
    }

    // 3. Unplanned high-priority: highest-scoring motivation linked to a backlog outcome
    const backlogOutcomeIds = new Set(outcomeRows.filter(o => !o.milestoneId).map(o => o.id));
    const unplannedHighPri = allMotivations
      .filter(m => backlogOutcomeIds.has(m.outcomeId))
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 1);

    if (unplannedHighPri.length > 0 && Number(unplannedHighPri[0].score || 0) > 0) {
      const m = unplannedHighPri[0];
      decisions.push({
        title: `High-priority item has no delivery plan`,
        detail: `"${truncate(m.title, 40)}" (${m.typeName}, score ${formatScore(m.score)}) is not assigned to any milestone`,
        recommendation: 'Assign to a milestone or create a new one',
      });
    }

    if (decisions.length > 0) {
      const slide = pres.addSlide();
      slide.addText('Needs Decision', { x: 0.5, y: 0.3, w: 11.7, h: 0.6, fontSize: 24, fontFace: 'Arial', color: BRAND.dark, bold: true });
      slide.addText('Trade-offs detected from current data — for discussion', {
        x: 0.5, y: 0.9, w: 11.7, h: 0.4, fontSize: 12, fontFace: 'Arial', color: BRAND.muted,
      });

      for (let i = 0; i < decisions.length; i++) {
        const d = decisions[i];
        const y = 1.8 + i * 1.7;

        slide.addText([
          { text: `${i + 1}. ${d.title}\n`, options: { fontSize: 16, bold: true, color: BRAND.dark } },
          { text: `${d.detail}\n`, options: { fontSize: 12, color: BRAND.dark } },
          { text: `Recommend: ${d.recommendation}`, options: { fontSize: 12, color: BRAND.accent, italic: true } },
        ], {
          x: 0.8, y, w: 11.5, h: 1.5, fontFace: 'Arial', valign: 'top',
        });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // APPENDIX: Detailed tables (all entities)
  // ═══════════════════════════════════════════════
  addSectionDivider(pres, 'Appendix', 'Detailed data for reference', BRAND.headerBg);

  // ─── All customers ───
  {
    const sortedCustomers = groupCustomersByRevenue(customerMotivations);

    for (const [customerName, mots] of sortedCustomers) {
      const slide = pres.addSlide();
      const totalRev = mots.reduce((sum, m) => sum + Number(m.attributes.revenue_at_risk || 0), 0);
      slide.addText(`${customerName}  ·  ${formatCurrency(totalRev)} at risk`, {
        x: 0.5, y: 0.3, w: 12, h: 0.6, fontSize: 18, fontFace: 'Arial', color: BRAND.dark, bold: true,
      });

      const dataRows = mots.map(m => [
        td(m.outcomeTitle), td(m.title),
        td((m.attributes.impact_type as string) || '\u2014'),
        td(m.attributes.confidence != null ? `${Math.round(Number(m.attributes.confidence) * 100)}%` : '\u2014'),
        td(m.targetDate || '\u2014'),
        td(formatScore(m.score), { bold: true }),
      ]);
      slide.addTable([
        [th('Outcome'), th('Motivation'), th('Impact'), th('Confidence'), th('Target'), th('Score')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.0, w: 12.3, colW: [3.0, 3.0, 1.2, 1.2, 1.2, 1.0],
        border: { type: 'solid', pt: 0.5, color: 'cccccc' }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }
  }

  // ─── All milestones ───
  {
    const outcomesByMs = new Map<string, OutcomeRow[]>();
    const backlog: OutcomeRow[] = [];
    for (const o of outcomeRows) {
      if (o.milestoneName) {
        if (!outcomesByMs.has(o.milestoneName)) outcomesByMs.set(o.milestoneName, []);
        outcomesByMs.get(o.milestoneName)!.push(o);
      } else {
        backlog.push(o);
      }
    }

    for (const ms of milestoneRows) {
      const msOutcomes = outcomesByMs.get(ms.name) || [];
      if (msOutcomes.length === 0) continue;

      const slide = pres.addSlide();
      slide.addText(ms.name, { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Arial', color: BRAND.dark, bold: true });
      slide.addText(`${ms.targetDate}  ·  ${ms.type}  ·  ${ms.status}  ·  ${ms.outcomeCount} outcomes  ·  Avg score ${ms.avgPriorityScore}`, {
        x: 0.5, y: 0.9, w: 12, h: 0.4, fontSize: 11, fontFace: 'Arial', color: BRAND.muted,
      });

      const dataRows = msOutcomes.map(o => [
        td(o.title), td(o.effort || '\u2014'), td(o.status),
        td(formatScore(o.priorityScore), { bold: true }),
        td(o.topMotivationType || '\u2014', { color: BRAND.muted }),
        td(o.tags || '\u2014', { color: BRAND.muted }),
      ]);

      slide.addTable([
        [th('Outcome'), th('Effort'), th('Status'), th('Score'), th('Top Motivation'), th('Tags')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.5, w: 12.3, colW: [3.5, 0.8, 1.2, 1.0, 2.0, 2.0],
        border: { type: 'solid', pt: 0.5, color: 'cccccc' }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }

    if (backlog.length > 0) {
      const slide = pres.addSlide();
      slide.addText('Backlog', { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Arial', color: BRAND.dark, bold: true });
      slide.addText(`${backlog.length} outcomes not assigned to a milestone`, {
        x: 0.5, y: 0.9, w: 12, h: 0.4, fontSize: 11, fontFace: 'Arial', color: BRAND.muted,
      });

      const dataRows = backlog.map(o => [
        td(o.title), td(o.effort || '\u2014'), td(o.status),
        td(formatScore(o.priorityScore), { bold: true }),
        td(o.topMotivationType || '\u2014', { color: BRAND.muted }),
      ]);
      slide.addTable([
        [th('Outcome'), th('Effort'), th('Status'), th('Score'), th('Top Motivation')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.5, w: 12.3, colW: [4.5, 1.0, 1.5, 1.2, 2.5],
        border: { type: 'solid', pt: 0.5, color: 'cccccc' }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }
  }

  // ─── Motivation type detail tables ───
  {
    const mandateMotivations = motivationsByType.get('Internal Mandate') || [];

    if (mandateMotivations.length > 0) {
      const slide = pres.addSlide();
      slide.addText('Internal Mandates', { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Arial', color: BRAND.dark, bold: true });
      const dataRows = mandateMotivations.map(m => [
        td(m.outcomeTitle), td(m.title),
        td((m.attributes.stakeholder as string) || '\u2014'),
        td((m.attributes.mandate_type as string) || '\u2014'),
        td((m.attributes.priority_override as string) || '\u2014'),
        td(m.targetDate || '\u2014'),
        td(formatScore(m.score), { bold: true }),
      ]);
      slide.addTable([
        [th('Outcome'), th('Mandate'), th('Stakeholder'), th('Type'), th('Priority'), th('Target'), th('Score')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.0, w: 12.3, colW: [2.8, 2.5, 1.5, 1.2, 1.0, 1.2, 0.8],
        border: { type: 'solid', pt: 0.5, color: 'cccccc' }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }

    if (techDebtMotivations.length > 0) {
      const slide = pres.addSlide();
      slide.addText('Tech Debt', { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Arial', color: BRAND.dark, bold: true });
      const dataRows = techDebtMotivations.map(m => [
        td(m.outcomeTitle), td(m.title),
        td(String(m.attributes.incident_frequency ?? '\u2014')),
        td((m.attributes.blast_radius as string) || '\u2014'),
        td(String(m.attributes.support_hours_monthly ?? '\u2014')),
        td((m.attributes.architectural_risk as string) || '\u2014'),
        td(formatScore(m.score), { bold: true }),
      ]);
      slide.addTable([
        [th('Outcome'), th('Issue'), th('Incidents/mo'), th('Blast Radius'), th('Support hrs'), th('Arch Risk'), th('Score')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.0, w: 12.3, colW: [2.8, 2.5, 1.2, 1.5, 1.2, 1.2, 0.8],
        border: { type: 'solid', pt: 0.5, color: 'cccccc' }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }

    if (complianceMotivations.length > 0) {
      const slide = pres.addSlide();
      slide.addText('Compliance', { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Arial', color: BRAND.dark, bold: true });
      const dataRows = complianceMotivations.map(m => [
        td(m.outcomeTitle),
        td((m.attributes.regulation as string) || '\u2014'),
        td((m.attributes.mandate_deadline as string) || '\u2014'),
        td((m.attributes.penalty_severity as string) || '\u2014'),
        td(m.attributes.legal_exposure != null ? formatCurrency(Number(m.attributes.legal_exposure)) : '\u2014'),
        td(formatScore(m.score), { bold: true }),
      ]);
      slide.addTable([
        [th('Outcome'), th('Regulation'), th('Deadline'), th('Severity'), th('Legal Exposure'), th('Score')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.0, w: 12.3, colW: [3.0, 2.5, 1.5, 1.2, 1.5, 1.0],
        border: { type: 'solid', pt: 0.5, color: 'cccccc' }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }

    if (competitiveMotivations.length > 0) {
      const slide = pres.addSlide();
      slide.addText('Competitive Gaps', { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Arial', color: BRAND.dark, bold: true });
      const dataRows = competitiveMotivations.map(m => [
        td(m.outcomeTitle),
        td((m.attributes.competitor as string) || '\u2014'),
        td((m.attributes.gap_severity as string) || '\u2014'),
        td(String(m.attributes.deals_lost ?? '\u2014')),
        td(m.attributes.confidence != null ? `${Math.round(Number(m.attributes.confidence) * 100)}%` : '\u2014'),
        td(formatScore(m.score), { bold: true }),
      ]);
      slide.addTable([
        [th('Outcome'), th('Competitor'), th('Gap Severity'), th('Deals Lost'), th('Confidence'), th('Score')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.0, w: 12.3, colW: [3.0, 2.0, 1.8, 1.2, 1.2, 1.0],
        border: { type: 'solid', pt: 0.5, color: 'cccccc' }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }
  }

  // ─── Send response ───
  const buffer = await pres.write({ outputType: 'nodebuffer' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="roadmap-${dateStr}.pptx"`);
  res.send(buffer);
});

export { buildStructuredData };
export default router;
