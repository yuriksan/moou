import { Router } from 'express';
import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');
import { db } from '../db/index.js';
import { outcomes, motivations, motivationTypes, outcomeMotivations, milestones, outcomeTags, motivationTags, tags, externalLinks } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { VALID_OUTCOME_STATUSES, VALID_EFFORT_SIZES, VALID_MILESTONE_STATUSES, VALID_MILESTONE_TYPES, safeSheetName } from '../lib/input-validation.js';
import { getAdapter } from '../providers/registry.js';

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

// Design palette — dark, professional
const DECK = {
  // Primary
  navy: '1a1f36',
  navyLight: '2d3250',
  white: 'ffffff',
  offWhite: 'f7f8fa',

  // Accent
  accent: '3b82f6',
  accentDim: 'dbeafe',

  // Status
  green: '16a34a',
  amber: 'f59e0b',
  red: 'dc2626',
  greenBg: 'f0fdf4',
  amberBg: 'fefce8',
  redBg: 'fef2f2',

  // Text
  textDark: '1e293b',
  textMuted: '64748b',
  textLight: '94a3b8',

  // Borders
  border: 'e2e8f0',
  borderLight: 'f1f5f9',
};

// Motivation type colors (richer)
const TYPE_COLORS: Record<string, string> = {
  'Customer Demand': '3b82f6',
  'Tech Debt': 'ef4444',
  'Compliance': '8b5cf6',
  'Competitive Gap': '10b981',
  'Internal Mandate': 'f59e0b',
};

/** Parse a date-only string (YYYY-MM-DD) to UTC midnight for DST-safe day math. */
function parseDateUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('T')[0]!.split('-').map(Number) as [number, number, number];
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
  if (status === 'completed' || status === 'active' || status === 'approved') return DECK.green;
  if (status === 'draft') return DECK.amber;
  if (status === 'deferred') return DECK.red;
  return DECK.textLight;
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

function addSectionDivider(pres: any, title: string, subtitle: string) {
  const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
  slide.addText(title, { x: 0.8, y: 2.5, w: 11.7, h: 1.0, fontSize: 36, fontFace: 'Calibri', color: DECK.textDark, bold: true });
  slide.addText(subtitle, { x: 0.8, y: 3.5, w: 11.7, h: 0.5, fontSize: 14, fontFace: 'Calibri', color: DECK.textMuted });
  return slide;
}

function addKpiCard(slide: any, opts: {
  x: number; y: number; w: number; h: number;
  accentColor: string; value: string; label: string; sublabel?: string;
}) {
  // White card with shadow
  slide.addShape('roundRect', {
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    fill: { color: DECK.white }, rectRadius: 0.04,
    shadow: { type: 'outer', blur: 6, offset: 2, color: '000000', opacity: 0.08 },
  });
  // Left accent border
  slide.addShape('rect', {
    x: opts.x, y: opts.y + 0.1, w: 0.05, h: opts.h - 0.2,
    fill: { color: opts.accentColor },
  });
  // Value
  slide.addText(opts.value, {
    x: opts.x + 0.3, y: opts.y + 0.3, w: opts.w - 0.5, h: 0.9,
    fontSize: 32, fontFace: 'Calibri', color: DECK.textDark, bold: true, valign: 'middle',
  });
  // Label
  slide.addText(opts.label, {
    x: opts.x + 0.3, y: opts.y + 1.2, w: opts.w - 0.5, h: 0.4,
    fontSize: 11, fontFace: 'Calibri', color: DECK.textMuted,
  });
  if (opts.sublabel) {
    slide.addText(opts.sublabel, {
      x: opts.x + 0.3, y: opts.y + 1.55, w: opts.w - 0.5, h: 0.3,
      fontSize: 9, fontFace: 'Calibri', color: DECK.textLight,
    });
  }
}

// Table helpers with new colors
function th(text: string) {
  return { text, options: { bold: true, fontSize: 10, color: DECK.white, fill: { color: DECK.navy } } };
}
function td(text: string, opts?: Record<string, unknown>) {
  return { text, options: { fontSize: 9, color: DECK.textDark, ...opts } };
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
  pres.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"

  const dateStr = new Date().toISOString().split('T')[0];
  const metrics = computeExecMetrics(outcomeRows, motivationsByType);
  const allMotivations = [...motivationsByType.values()].flat();

  // ─── Slide Master ───
  pres.defineSlideMaster({
    title: 'MOOU_MASTER',
    background: { color: DECK.offWhite },
    objects: [
      // Thin accent bar at top
      { rect: { x: 0, y: 0, w: 13.33, h: 0.06, fill: { color: DECK.accent } } },
      // Footer left
      { text: { text: 'Confidential \u00b7 moou', options: { x: 0.5, y: 7.1, w: 4.0, h: 0.3, fontSize: 8, fontFace: 'Calibri', color: DECK.textLight } } },
    ],
    slideNumber: { x: 12.0, y: 7.1, w: 1.0, h: 0.3, fontSize: 9, fontFace: 'Calibri', color: DECK.textMuted },
  });

  // ─── Derive quarter from nearest milestone date ───
  function deriveQuarter(): string {
    const dates = milestoneRows
      .filter(ms => ms.status !== 'completed')
      .map(ms => parseDateUTC(ms.targetDate));
    const target = dates.length > 0 ? dates[0]! : new Date();
    const q = Math.ceil((target.getUTCMonth() + 1) / 3);
    return `Q${q} ${target.getUTCFullYear()}`;
  }

  // ─── Empty-data guard ───
  if (outcomeRows.length === 0 && allMotivations.length === 0) {
    const titleSlide2 = pres.addSlide();
    titleSlide2.background = { color: DECK.navy };
    titleSlide2.addText('Product Roadmap', { x: 0.8, y: 1.5, w: 11.7, h: 1.5, fontSize: 44, fontFace: 'Calibri', color: DECK.white, bold: true });
    titleSlide2.addText(`Confidential \u00b7 Generated ${dateStr} \u00b7 moou`, { x: 0.8, y: 5.8, w: 11.7, h: 0.5, fontSize: 10, fontFace: 'Calibri', color: DECK.textLight });
    const emptySlide = pres.addSlide({ masterName: 'MOOU_MASTER' });
    emptySlide.addText('No data yet', { x: 0.8, y: 2.0, w: 11.7, h: 1.0, fontSize: 32, fontFace: 'Calibri', color: DECK.textDark, bold: true, align: 'center' });
    emptySlide.addText('Add outcomes and motivations to generate your roadmap', {
      x: 0.8, y: 3.2, w: 11.7, h: 0.5, fontSize: 14, fontFace: 'Calibri', color: DECK.textMuted, align: 'center',
    });
    const buffer = await pres.write({ outputType: 'nodebuffer' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="roadmap-${dateStr}.pptx"`);
    res.send(buffer);
    return;
  }

  // ═══════════════════════════════════════════════
  // SLIDE 1: Title (custom dark — no master)
  // ═══════════════════════════════════════════════
  {
    const titleSlide = pres.addSlide();
    titleSlide.background = { color: DECK.navy };
    titleSlide.addText('Product Roadmap', { x: 0.8, y: 2.0, w: 11.7, h: 1.5, fontSize: 44, fontFace: 'Calibri', color: DECK.white, bold: true });
    titleSlide.addText(deriveQuarter(), { x: 0.8, y: 3.5, w: 11.7, h: 0.7, fontSize: 20, fontFace: 'Calibri', color: DECK.textLight });
    titleSlide.addText(`Confidential \u00b7 Generated ${dateStr} \u00b7 moou`, { x: 0.8, y: 5.8, w: 11.7, h: 0.5, fontSize: 10, fontFace: 'Calibri', color: DECK.textLight });
  }

  // ═══════════════════════════════════════════════
  // SLIDE 2: "Where We Stand" — Health Dashboard
  // ═══════════════════════════════════════════════
  {
    const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });

    const onTrackPct = metrics.outcomesTotal > 0 ? Math.round((metrics.outcomesOnTrack / metrics.outcomesTotal) * 100) : 0;
    const complianceText = metrics.complianceDaysUntil !== null
      ? (metrics.complianceDaysUntil < 0 ? `compliance ${Math.abs(metrics.complianceDaysUntil)}d overdue` : `compliance in ${metrics.complianceDaysUntil}d`)
      : 'no compliance deadlines';
    const revenueText = metrics.totalRevenueAtRisk > 0 ? formatCurrency(metrics.totalRevenueAtRisk) : '$0';
    const takeawayTitle = `${onTrackPct}% on track \u00b7 ${revenueText} at risk \u00b7 ${complianceText}`;

    slide.addText(takeawayTitle, { x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 22, fontFace: 'Calibri', color: DECK.textDark, bold: true });

    const cardW = 3.8;
    const cardH = 2.2;
    const cardGap = 0.35;
    const startX = 0.5;
    const cardY = 1.3;

    // Card 1: Revenue at risk
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
      x: startX, y: cardY, w: cardW, h: cardH,
      accentColor: metrics.totalRevenueAtRisk > 0 ? DECK.red : DECK.textLight,
      value: formatCurrency(metrics.totalRevenueAtRisk),
      label: 'Revenue at Risk',
      sublabel: revSublabel,
    });

    // Card 2: On-track %
    const onTrackAccent = onTrackPct >= 70 ? DECK.green : onTrackPct >= 40 ? DECK.amber : DECK.red;
    addKpiCard(slide, {
      x: startX + cardW + cardGap, y: cardY, w: cardW, h: cardH,
      accentColor: onTrackAccent,
      value: `${onTrackPct}%`,
      label: 'Outcomes On Track',
      sublabel: `${metrics.outcomesOnTrack} of ${metrics.outcomesTotal} \u00b7 ${metrics.outcomesCompleted} completed`,
    });

    // Card 3: Compliance deadline
    const complianceValue = metrics.complianceDaysUntil !== null
      ? (metrics.complianceDaysUntil < 0 ? `${Math.abs(metrics.complianceDaysUntil)}d overdue` : `${metrics.complianceDaysUntil}d`)
      : 'None';
    const complianceLabel = metrics.complianceDaysUntil === null
      ? 'Compliance Deadline'
      : (metrics.complianceDaysUntil < 0 ? 'Days Overdue' : 'Until Next Deadline');
    addKpiCard(slide, {
      x: startX + 2 * (cardW + cardGap), y: cardY, w: cardW, h: cardH,
      accentColor: '8b5cf6',
      value: complianceValue,
      label: complianceLabel,
      sublabel: metrics.complianceRegulation ? truncate(metrics.complianceRegulation, 40) : undefined,
    });

    // Portfolio mix doughnut (bottom-right area)
    const typeLabels: string[] = [];
    const typeValues: number[] = [];
    const typeColors: string[] = [];
    const sortedTypeScores = [...metrics.typeScores.entries()].sort((a, b) => b[1] - a[1]);
    for (const [typeName, totalScore] of sortedTypeScores) {
      if (totalScore > 0) {
        typeLabels.push(typeName);
        typeValues.push(totalScore);
        typeColors.push(TYPE_COLORS[typeName] || DECK.textMuted);
      }
    }
    if (typeLabels.length > 0) {
      slide.addChart('doughnut', [{ labels: typeLabels, values: typeValues }], {
        x: 7.5, y: 3.8, w: 5.3, h: 3.2,
        holeSize: 50,
        showPercent: true,
        showLabel: true,
        dataLabelPosition: 'outEnd',
        dataLabelFontSize: 9,
        chartColors: typeColors,
        showLegend: true,
        legendPos: 'b',
        legendFontSize: 9,
      });
    }
  }

  // ═══════════════════════════════════════════════
  // SLIDE 3: "Current Delivery" — Swimlane Timeline
  // ═══════════════════════════════════════════════
  {
    const activeMilestones = milestoneRows
      .filter(ms => ms.status !== 'completed')
      .slice(0, 6);

    // Group outcomes by milestone
    const outcomesByMs = new Map<string, OutcomeRow[]>();
    for (const o of outcomeRows) {
      if (o.milestoneName) {
        if (!outcomesByMs.has(o.milestoneName)) outcomesByMs.set(o.milestoneName, []);
        outcomesByMs.get(o.milestoneName)!.push(o);
      }
    }

    const activeOutcomeCount = activeMilestones.reduce((s, ms) => s + ms.outcomeCount, 0);
    const titleText = activeMilestones.length > 0
      ? `${activeMilestones.length} milestones in flight \u00b7 ${activeOutcomeCount} outcomes`
      : 'No active milestones';

    const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
    slide.addText(titleText, { x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 22, fontFace: 'Calibri', color: DECK.textDark, bold: true });

    if (activeMilestones.length > 0) {
      const laneLeft = 0.5;
      const labelW = 2.5;
      const trackLeft = 3.2;
      const trackW = 9.6;
      const laneH = 0.9;
      const laneGap = 0.15;
      const startY = 1.4;
      const blockW = 0.9;
      const blockH = 0.45;
      const blockGap = 0.12;

      for (let i = 0; i < activeMilestones.length; i++) {
        const ms = activeMilestones[i]!;
        const y = startY + i * (laneH + laneGap);

        // Lane background
        slide.addShape('rect', {
          x: trackLeft, y, w: trackW, h: laneH,
          fill: { color: DECK.borderLight },
        });

        // Milestone label on left
        slide.addText(truncate(ms.name, 22), {
          x: laneLeft, y, w: labelW, h: laneH * 0.55,
          fontSize: 11, fontFace: 'Calibri', color: DECK.textDark, bold: true, align: 'right', valign: 'middle',
        });
        slide.addText(ms.targetDate, {
          x: laneLeft, y: y + laneH * 0.5, w: labelW, h: laneH * 0.45,
          fontSize: 9, fontFace: 'Calibri', color: DECK.textMuted, align: 'right', valign: 'top',
        });

        // Outcome blocks within the lane
        const msOutcomes = (outcomesByMs.get(ms.name) || [])
          .slice().sort((a, b) => Number(b.priorityScore) - Number(a.priorityScore));
        const maxBlocks = 8;
        const shown = msOutcomes.slice(0, maxBlocks);
        const remaining = msOutcomes.length - shown.length;

        for (let j = 0; j < shown.length; j++) {
          const o = shown[j]!;
          const bx = trackLeft + 0.15 + j * (blockW + blockGap);
          const by = y + (laneH - blockH) / 2;
          const color = statusColor(o.status);

          slide.addShape('roundRect', {
            x: bx, y: by, w: blockW, h: blockH,
            fill: { color }, rectRadius: 0.03,
          });
          slide.addText(truncate(o.title, 10), {
            x: bx, y: by, w: blockW, h: blockH,
            fontSize: 7, fontFace: 'Calibri', color: DECK.white, align: 'center', valign: 'middle',
          });
        }

        if (remaining > 0) {
          const overflowX = trackLeft + 0.15 + shown.length * (blockW + blockGap);
          slide.addText(`+${remaining}`, {
            x: overflowX, y: y + (laneH - blockH) / 2, w: 0.5, h: blockH,
            fontSize: 9, fontFace: 'Calibri', color: DECK.textMuted, valign: 'middle',
          });
        }
      }
    } else if (milestoneRows.length > 0) {
      // All completed
      slide.addText('All milestones are completed', { x: 0.5, y: 1.5, w: 12.3, h: 0.5, fontSize: 14, fontFace: 'Calibri', color: DECK.textMuted, align: 'center' });
      const rows = milestoneRows.slice(0, 10).map(ms => [
        td(ms.name), td(ms.targetDate), td(`${ms.outcomeCount} outcomes`), td(`${ms.completedCount} done`),
      ]);
      slide.addTable([
        [th('Milestone'), th('Date'), th('Outcomes'), th('Completed')],
        ...rows,
      ], { x: 0.5, y: 2.2, w: 12.3, colW: [5, 2, 2.5, 2.8], border: { type: 'solid', pt: 0.5, color: DECK.border }, rowH: 0.35 });
    }
  }

  // ═══════════════════════════════════════════════
  // SLIDE 4: "Revenue at Stake" — Customer Impact
  // ═══════════════════════════════════════════════
  {
    const customerMotivations = motivationsByType.get('Customer Demand') || [];

    if (customerMotivations.length > 0) {
      const sortedCustomers = groupCustomersByRevenue(customerMotivations);
      const top5 = sortedCustomers.slice(0, 5);

      if (top5.length > 0) {
        const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
        const totalRev = metrics.totalRevenueAtRisk;
        slide.addText(`${formatCurrency(totalRev)} at risk across ${sortedCustomers.length} customers`, {
          x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 22, fontFace: 'Calibri', color: DECK.textDark, bold: true,
        });

        const barLabels = top5.map(([name]) => truncate(name, 25));
        const barValues = top5.map(([, mots]) => mots.reduce((s, m) => s + Number(m.attributes.revenue_at_risk || 0), 0));

        slide.addChart('bar', [{ labels: barLabels, values: barValues }], {
          x: 0.5, y: 1.3, w: 12.3, h: 5.8,
          barDir: 'bar',
          barGapWidthPct: 80,
          chartColors: ['3b82f6', '60a5fa', '93c5fd', 'bfdbfe', 'dbeafe'],
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
    }
  }

  // ═══════════════════════════════════════════════
  // SLIDE 5: "What Needs Attention" — Decisions
  // ═══════════════════════════════════════════════
  {
    const complianceMotivations = motivationsByType.get('Compliance') || [];
    const decisions: { title: string; detail: string; recommendation: string }[] = [];
    const outcomesById = new Map(outcomeRows.map(o => [o.id, o]));

    // 1. Compliance vs Delivery
    for (const m of complianceMotivations) {
      const deadline = m.attributes.mandate_deadline as string | undefined;
      if (!deadline) continue;
      const outcome = outcomesById.get(m.outcomeId);
      if (!outcome?.milestoneDate) continue;
      const deadlineDate = parseDateUTC(deadline);
      const milestoneDate = parseDateUTC(outcome.milestoneDate);
      if (deadlineDate < milestoneDate) {
        decisions.push({
          title: 'Compliance deadline before delivery',
          detail: `"${truncate(m.title, 40)}" deadline is ${deadline}, but milestone "${truncate(outcome.milestoneName || '', 25)}" targets ${outcome.milestoneDate}`,
          recommendation: 'Pull the milestone forward or split the outcome',
        });
        break;
      }
    }

    // 2. Overloaded milestone
    if (milestoneRows.length > 0) {
      const activeMilestones = milestoneRows.filter(ms => ms.status !== 'completed' && ms.outcomeCount > 0);
      if (activeMilestones.length > 0) {
        const worst = activeMilestones.slice().sort((a, b) => {
          const pctA = a.completedCount / a.outcomeCount;
          const pctB = b.completedCount / b.outcomeCount;
          return (pctA - a.outcomeCount * 0.01) - (pctB - b.outcomeCount * 0.01);
        })[0]!;
        const pct = Math.round((worst.completedCount / worst.outcomeCount) * 100);
        if (pct < 50 && worst.outcomeCount >= 3) {
          decisions.push({
            title: 'Overloaded milestone',
            detail: `"${truncate(worst.name, 30)}" has ${worst.outcomeCount} outcomes but only ${pct}% complete (target: ${worst.targetDate})`,
            recommendation: 'Reduce scope or extend the target date',
          });
        }
      }
    }

    // 3. Unplanned high-priority
    const backlogOutcomeIds = new Set(outcomeRows.filter(o => !o.milestoneId).map(o => o.id));
    const unplannedHighPri = allMotivations
      .filter(m => backlogOutcomeIds.has(m.outcomeId) && Number(m.score || 0) > 0)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 3);

    if (unplannedHighPri.length > 0) {
      const names = unplannedHighPri.map(m => `"${truncate(m.title, 30)}"`).join(', ');
      const topM = unplannedHighPri[0]!;
      decisions.push({
        title: `${unplannedHighPri.length} high-priority item${unplannedHighPri.length > 1 ? 's have' : ' has'} no delivery plan`,
        detail: `${names} (top score: ${formatScore(topM.score)}, ${topM.typeName}) not assigned to any milestone`,
        recommendation: 'Assign to a milestone or create a new one',
      });
    }

    if (decisions.length > 0) {
      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
      slide.addText('Needs Decision', { x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 22, fontFace: 'Calibri', color: DECK.textDark, bold: true });
      slide.addText('Trade-offs detected from current data \u2014 for discussion', {
        x: 0.5, y: 0.9, w: 12.3, h: 0.4, fontSize: 12, fontFace: 'Calibri', color: DECK.textMuted,
      });

      for (let i = 0; i < Math.min(decisions.length, 3); i++) {
        const d = decisions[i]!;
        const cardY = 1.7 + i * 1.7;
        const cardX = 0.5;
        const cW = 12.3;
        const cH = 1.5;

        // Card background
        slide.addShape('roundRect', {
          x: cardX, y: cardY, w: cW, h: cH,
          fill: { color: DECK.white }, rectRadius: 0.04,
          shadow: { type: 'outer', blur: 4, offset: 1, color: '000000', opacity: 0.06 },
        });
        // Red left accent
        slide.addShape('rect', {
          x: cardX, y: cardY + 0.1, w: 0.05, h: cH - 0.2,
          fill: { color: DECK.red },
        });
        // Text content
        slide.addText([
          { text: `${d.title}\n`, options: { fontSize: 14, bold: true, color: DECK.textDark } },
          { text: `${d.detail}\n`, options: { fontSize: 11, color: DECK.textDark } },
          { text: `Recommend: ${d.recommendation}`, options: { fontSize: 11, color: DECK.accent, italic: true } },
        ], {
          x: cardX + 0.3, y: cardY + 0.15, w: cW - 0.5, h: cH - 0.3, fontFace: 'Calibri', valign: 'top',
        });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // SLIDE 6: "What's Ahead" — Future Work
  // ═══════════════════════════════════════════════
  {
    const today = todayUTC();
    const futureMilestones = milestoneRows.filter(ms =>
      ms.status === 'upcoming' && parseDateUTC(ms.targetDate).getTime() > today.getTime()
    );

    if (futureMilestones.length > 0) {
      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });

      // Group outcomes by milestone for avg score
      const outcomesByMs = new Map<string, OutcomeRow[]>();
      for (const o of outcomeRows) {
        if (o.milestoneName) {
          if (!outcomesByMs.has(o.milestoneName)) outcomesByMs.set(o.milestoneName, []);
          outcomesByMs.get(o.milestoneName)!.push(o);
        }
      }

      slide.addText(`Planning Ahead \u00b7 ${futureMilestones.length} upcoming milestones`, {
        x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 22, fontFace: 'Calibri', color: DECK.textDark, bold: true,
      });

      const dataRows = futureMilestones.slice(0, 10).map(ms => [
        td(truncate(ms.name, 35), { color: DECK.textMuted }),
        td(ms.targetDate, { color: DECK.textMuted }),
        td(String(ms.outcomeCount), { color: DECK.textMuted }),
        td(String(ms.avgPriorityScore), { color: DECK.textMuted }),
        td(ms.type, { color: DECK.textLight }),
      ]);

      slide.addTable([
        [th('Milestone'), th('Target Date'), th('Outcomes'), th('Avg Score'), th('Type')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.3, w: 12.3,
        colW: [4.5, 2.0, 1.5, 1.5, 2.0],
        border: { type: 'solid', pt: 0.5, color: DECK.border },
        rowH: 0.4,
      });

      slide.addText('Planned, not yet committed', {
        x: 0.5, y: 6.8, w: 12.3, h: 0.3, fontSize: 10, fontFace: 'Calibri', color: DECK.textLight, italic: true,
      });
    }
  }

  // ═══════════════════════════════════════════════
  // SLIDE 7: "Why This Roadmap" — Motivations
  // ═══════════════════════════════════════════════
  {
    // Doughnut + top motivations
    const typeLabels: string[] = [];
    const typeValues: number[] = [];
    const typeColors: string[] = [];
    const sortedTypeScores = [...metrics.typeScores.entries()].sort((a, b) => b[1] - a[1]);
    for (const [typeName, totalScore] of sortedTypeScores) {
      if (totalScore > 0) {
        typeLabels.push(typeName);
        typeValues.push(totalScore);
        typeColors.push(TYPE_COLORS[typeName] || DECK.textMuted);
      }
    }

    if (typeLabels.length > 0) {
      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
      slide.addText("What's Driving the Roadmap", { x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 22, fontFace: 'Calibri', color: DECK.textDark, bold: true });

      // Left side: doughnut
      slide.addChart('doughnut', [{ labels: typeLabels, values: typeValues }], {
        x: 0.3, y: 1.2, w: 6.0, h: 5.5,
        holeSize: 50,
        showPercent: true,
        showLabel: true,
        dataLabelPosition: 'outEnd',
        dataLabelFontSize: 10,
        chartColors: typeColors,
        showLegend: true,
        legendPos: 'b',
        legendFontSize: 10,
      });

      // Right side: top 5 motivations by score
      const topMotivations = allMotivations
        .slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 5);

      for (let i = 0; i < topMotivations.length; i++) {
        const m = topMotivations[i]!;
        const y = 1.5 + i * 1.1;
        const typeColor = TYPE_COLORS[m.typeName] || DECK.textMuted;

        // Type pill
        slide.addShape('roundRect', {
          x: 6.8, y: y, w: 1.6, h: 0.3,
          fill: { color: typeColor }, rectRadius: 0.08,
        });
        slide.addText(truncate(m.typeName, 18), {
          x: 6.8, y: y, w: 1.6, h: 0.3,
          fontSize: 8, fontFace: 'Calibri', color: DECK.white, align: 'center', valign: 'middle',
        });
        // Title + score
        slide.addText(truncate(m.title, 35), {
          x: 8.6, y: y - 0.05, w: 3.8, h: 0.35,
          fontSize: 11, fontFace: 'Calibri', color: DECK.textDark, bold: true,
        });
        slide.addText(`Score: ${formatScore(m.score)}`, {
          x: 8.6, y: y + 0.3, w: 3.8, h: 0.3,
          fontSize: 9, fontFace: 'Calibri', color: DECK.textMuted,
        });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // SLIDE 8: "Risks on the Horizon" — Future Risks
  // ═══════════════════════════════════════════════
  {
    const techDebtMotivations = motivationsByType.get('Tech Debt') || [];
    const complianceMotivations = motivationsByType.get('Compliance') || [];
    const competitiveMotivations = motivationsByType.get('Competitive Gap') || [];

    const hasRiskSection = techDebtMotivations.length > 0 || complianceMotivations.length > 0 || competitiveMotivations.length > 0;

    if (hasRiskSection) {
      const today = todayUTC();
      // Count compliance deadlines in next 90 days
      const complianceNext90 = complianceMotivations.filter(m => {
        const deadline = m.attributes.mandate_deadline as string | undefined;
        if (!deadline) return false;
        const d = parseDateUTC(deadline);
        const days = Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
        return days >= 0 && days <= 90;
      }).length;

      const riskTitle = complianceNext90 > 0
        ? `${complianceNext90} compliance deadline${complianceNext90 > 1 ? 's' : ''} in next 90 days`
        : 'Risks on the Horizon';

      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
      slide.addText(riskTitle, { x: 0.5, y: 0.3, w: 12.3, h: 0.7, fontSize: 22, fontFace: 'Calibri', color: DECK.textDark, bold: true });

      const cards: { color: string; title: string; metric: string; detail1: string; detail2: string }[] = [];

      if (complianceMotivations.length > 0) {
        const compMetric = metrics.complianceDaysUntil !== null
          ? (metrics.complianceDaysUntil < 0 ? `Overdue ${Math.abs(metrics.complianceDaysUntil)}d` : `${metrics.complianceDaysUntil} days`)
          : 'No deadline';
        cards.push({
          color: '8b5cf6',
          title: 'Compliance',
          metric: compMetric,
          detail1: metrics.complianceRegulation ? truncate(metrics.complianceRegulation, 35) : '',
          detail2: metrics.totalLegalExposure > 0 ? `Legal exposure: ${formatCurrency(metrics.totalLegalExposure)}` : '',
        });
      }

      if (techDebtMotivations.length > 0) {
        const topTD = techDebtMotivations.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0]!;
        cards.push({
          color: 'ef4444',
          title: 'Tech Debt',
          metric: `${metrics.techDebtIncidentsTotal} incidents/mo`,
          detail1: truncate(topTD.title, 35),
          detail2: `Blast radius: ${(topTD.attributes.blast_radius as string) || 'unknown'}`,
        });
      }

      if (competitiveMotivations.length > 0) {
        const topComp = competitiveMotivations.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0]!;
        const totalDeals = competitiveMotivations.reduce((s, m) => s + Number(m.attributes.deals_lost || 0), 0);
        cards.push({
          color: '10b981',
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
        const c = cards[i]!;
        const x = offsetX + i * (cardW + gap);
        const y = 1.3;
        const h = 5.0;

        // Card background
        slide.addShape('roundRect', {
          x, y: y, w: cardW, h: h,
          fill: { color: DECK.white }, rectRadius: 0.04,
          shadow: { type: 'outer', blur: 6, offset: 2, color: '000000', opacity: 0.08 },
        });

        // Colored top border
        slide.addShape('rect', { x: x + 0.1, y, w: cardW - 0.2, h: 0.06, fill: { color: c.color } });

        // Title in category color
        slide.addText(c.title, { x, y: y + 0.3, w: cardW, h: 0.5, fontSize: 14, fontFace: 'Calibri', color: c.color, bold: true, align: 'center' });

        // Big metric
        slide.addText(c.metric, { x, y: y + 1.0, w: cardW, h: 1.2, fontSize: 28, fontFace: 'Calibri', color: DECK.textDark, bold: true, align: 'center', valign: 'middle' });

        // Detail lines
        slide.addText(c.detail1, { x: x + 0.2, y: y + 2.5, w: cardW - 0.4, h: 0.5, fontSize: 11, fontFace: 'Calibri', color: DECK.textDark, align: 'center' });
        slide.addText(c.detail2, { x: x + 0.2, y: y + 3.2, w: cardW - 0.4, h: 0.5, fontSize: 11, fontFace: 'Calibri', color: DECK.textMuted, align: 'center' });
      }
    }
  }

  // ═══════════════════════════════════════════════
  // APPENDIX
  // ═══════════════════════════════════════════════
  addSectionDivider(pres, 'Appendix', 'Detailed data for reference');

  // ─── All customers ───
  {
    const customerMotivations = motivationsByType.get('Customer Demand') || [];
    const sortedCustomers = groupCustomersByRevenue(customerMotivations);

    for (const [customerName, mots] of sortedCustomers) {
      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
      const totalRev = mots.reduce((sum, m) => sum + Number(m.attributes.revenue_at_risk || 0), 0);
      slide.addText(`${customerName}  \u00b7  ${formatCurrency(totalRev)} at risk`, {
        x: 0.5, y: 0.3, w: 12, h: 0.6, fontSize: 18, fontFace: 'Calibri', color: DECK.textDark, bold: true,
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
        border: { type: 'solid', pt: 0.5, color: DECK.border }, rowH: 0.35,
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

      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
      slide.addText(ms.name, { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Calibri', color: DECK.textDark, bold: true });
      slide.addText(`${ms.targetDate}  \u00b7  ${ms.type}  \u00b7  ${ms.status}  \u00b7  ${ms.outcomeCount} outcomes  \u00b7  Avg score ${ms.avgPriorityScore}`, {
        x: 0.5, y: 0.9, w: 12, h: 0.4, fontSize: 11, fontFace: 'Calibri', color: DECK.textMuted,
      });

      const dataRows = msOutcomes.map(o => [
        td(o.title), td(o.effort || '\u2014'), td(o.status),
        td(formatScore(o.priorityScore), { bold: true }),
        td(o.topMotivationType || '\u2014', { color: DECK.textMuted }),
        td(o.tags || '\u2014', { color: DECK.textMuted }),
      ]);

      slide.addTable([
        [th('Outcome'), th('Effort'), th('Status'), th('Score'), th('Top Motivation'), th('Tags')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.5, w: 12.3, colW: [3.5, 0.8, 1.2, 1.0, 2.0, 2.0],
        border: { type: 'solid', pt: 0.5, color: DECK.border }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }

    if (backlog.length > 0) {
      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
      slide.addText('Backlog', { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Calibri', color: DECK.textDark, bold: true });
      slide.addText(`${backlog.length} outcomes not assigned to a milestone`, {
        x: 0.5, y: 0.9, w: 12, h: 0.4, fontSize: 11, fontFace: 'Calibri', color: DECK.textMuted,
      });

      const dataRows = backlog.map(o => [
        td(o.title), td(o.effort || '\u2014'), td(o.status),
        td(formatScore(o.priorityScore), { bold: true }),
        td(o.topMotivationType || '\u2014', { color: DECK.textMuted }),
      ]);
      slide.addTable([
        [th('Outcome'), th('Effort'), th('Status'), th('Score'), th('Top Motivation')],
        ...dataRows,
      ], {
        x: 0.5, y: 1.5, w: 12.3, colW: [4.5, 1.0, 1.5, 1.2, 2.5],
        border: { type: 'solid', pt: 0.5, color: DECK.border }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }
  }

  // ─── Motivation type detail tables ───
  {
    const techDebtMotivations = motivationsByType.get('Tech Debt') || [];
    const complianceMotivations = motivationsByType.get('Compliance') || [];
    const competitiveMotivations = motivationsByType.get('Competitive Gap') || [];
    const mandateMotivations = motivationsByType.get('Internal Mandate') || [];

    if (mandateMotivations.length > 0) {
      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
      slide.addText('Internal Mandates', { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Calibri', color: DECK.textDark, bold: true });
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
        border: { type: 'solid', pt: 0.5, color: DECK.border }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }

    if (techDebtMotivations.length > 0) {
      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
      slide.addText('Tech Debt', { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Calibri', color: DECK.textDark, bold: true });
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
        border: { type: 'solid', pt: 0.5, color: DECK.border }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }

    if (complianceMotivations.length > 0) {
      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
      slide.addText('Compliance', { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Calibri', color: DECK.textDark, bold: true });
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
        border: { type: 'solid', pt: 0.5, color: DECK.border }, rowH: 0.35,
        autoPage: true, autoPageRepeatHeader: true,
      });
    }

    if (competitiveMotivations.length > 0) {
      const slide = pres.addSlide({ masterName: 'MOOU_MASTER' });
      slide.addText('Competitive Gaps', { x: 0.5, y: 0.3, w: 7, h: 0.6, fontSize: 18, fontFace: 'Calibri', color: DECK.textDark, bold: true });
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
        border: { type: 'solid', pt: 0.5, color: DECK.border }, rowH: 0.35,
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
