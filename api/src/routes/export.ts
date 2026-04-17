import { Router } from 'express';
import ExcelJS from 'exceljs';
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
      primaryLinkUrl: o.primaryLinkUrl || '',
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
  // No sheet protection on Timeline — locked cells prevent row sorting even when sort is permitted.
  // Read-only intent is indicated by grey cell styling. Validation (dropdowns) still applies.

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

export { buildStructuredData };
export default router;
