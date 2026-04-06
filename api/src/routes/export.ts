import { Router } from 'express';
import ExcelJS from 'exceljs';
import { db } from '../db/index.js';
import { outcomes, motivations, motivationTypes, outcomeMotivations, milestones, outcomeTags, motivationTags, tags } from '../db/schema.js';
import { eq, sql, isNull } from 'drizzle-orm';

const router = Router();

/**
 * Sanitize cell values to prevent Excel formula injection.
 * Cells starting with =, +, -, @, \t, \r are prefixed with a single quote.
 */
function sanitizeCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

/**
 * Escape Markdown metacharacters in user-supplied inline content. Without
 * this, an outcome title like `Build *new* feature [link](http://evil)`
 * renders as italic + a clickable link in the exported document — content
 * the user never wrote.
 *
 * Conservative scope: backslash the chars that break out of a single line
 * of inline text (`*`, `_`, `` ` ``, `[`, `]`, `(`, `)`, `|`, `<`, `>`, `!`)
 * plus the escape char itself. We deliberately do NOT escape `.` or `+`
 * because over-escaping inline punctuation makes the output unreadable.
 */
function escapeMarkdown(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/([\\`*_\[\]()<>|!])/g, '\\$1');
}

/**
 * Escape multi-line markdown content (descriptions, notes) so a user's
 * description starting with `## Summary` or `- bullet` can't break out of
 * the export's own heading or list hierarchy.
 *
 * Order of operations matters: do inline escape FIRST (which leaves `#`,
 * `-`, `>`, and digits alone — those only matter at line start), then
 * prepend a backslash to leading heading / list / blockquote markers. Doing
 * the block pass first would let the inline pass double-escape the
 * backslash we just added.
 */
function escapeMarkdownBlock(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .split('\n')
    .map(line => {
      const inlineEscaped = escapeMarkdown(line);
      // Match leading whitespace + heading (#…), blockquote (>), unordered
      // list (-, +), or ordered list (digit.). Escape the marker character.
      return inlineEscaped.replace(
        /^(\s*)(#{1,6}\s|>\s|[-+]\s|\d+\.\s)/,
        (_match, ws, marker) => ws + '\\' + marker,
      );
    })
    .join('\n');
}

// ─── Shared: build the full dataset ───

interface ExportRow {
  outcomeId: string;
  outcomeTitle: string;
  outcomeDescription: string | null;
  outcomeEffort: string | null;
  outcomeStatus: string;
  outcomePriorityScore: string;
  milestoneName: string | null;
  milestoneId: string | null;
  outcomeTags: string;
  motivationId: string | null;
  motivationTitle: string | null;
  motivationType: string | null;
  motivationScore: string | null;
  motivationStatus: string | null;
  motivationAttributes: Record<string, unknown> | null;
}

async function buildExportData(): Promise<{ rows: ExportRow[]; allAttrKeys: string[] }> {
  // Get all outcomes with their milestones
  const allOutcomes = await db.select({
    id: outcomes.id,
    title: outcomes.title,
    description: outcomes.description,
    effort: outcomes.effort,
    status: outcomes.status,
    priorityScore: outcomes.priorityScore,
    milestoneId: outcomes.milestoneId,
    milestoneName: milestones.name,
  }).from(outcomes)
    .leftJoin(milestones, eq(outcomes.milestoneId, milestones.id))
    .orderBy(sql`${milestones.targetDate} NULLS LAST`, sql`${outcomes.priorityScore} DESC`);

  // Get all outcome-motivation links with motivation details
  const allLinks = await db.select({
    outcomeId: outcomeMotivations.outcomeId,
    motivationId: motivations.id,
    motivationTitle: motivations.title,
    motivationType: motivationTypes.name,
    motivationScore: motivations.score,
    motivationStatus: motivations.status,
    motivationAttributes: motivations.attributes,
  }).from(outcomeMotivations)
    .innerJoin(motivations, eq(outcomeMotivations.motivationId, motivations.id))
    .innerJoin(motivationTypes, eq(motivations.typeId, motivationTypes.id));

  // Get tags for outcomes
  const allOutcomeTags = await db.select({
    outcomeId: outcomeTags.outcomeId,
    tagName: tags.name,
  }).from(outcomeTags)
    .innerJoin(tags, eq(outcomeTags.tagId, tags.id));

  const outcomeTagMap = new Map<string, string[]>();
  for (const ot of allOutcomeTags) {
    if (!outcomeTagMap.has(ot.outcomeId)) outcomeTagMap.set(ot.outcomeId, []);
    outcomeTagMap.get(ot.outcomeId)!.push(ot.tagName);
  }

  // Collect all unique attribute keys across all motivations
  const allAttrKeys = new Set<string>();
  for (const link of allLinks) {
    if (link.motivationAttributes) {
      for (const key of Object.keys(link.motivationAttributes as Record<string, unknown>)) {
        allAttrKeys.add(key);
      }
    }
  }

  // Build right-joined rows: each motivation gets a row, outcomes span multiple rows
  const rows: ExportRow[] = [];
  const linksByOutcome = new Map<string, typeof allLinks>();
  for (const link of allLinks) {
    if (!linksByOutcome.has(link.outcomeId)) linksByOutcome.set(link.outcomeId, []);
    linksByOutcome.get(link.outcomeId)!.push(link);
  }

  for (const o of allOutcomes) {
    const oLinks = linksByOutcome.get(o.id) || [];
    const oTags = outcomeTagMap.get(o.id)?.join(', ') || '';

    if (oLinks.length === 0) {
      // Outcome with no motivations — single row
      rows.push({
        outcomeId: o.id,
        outcomeTitle: o.title,
        outcomeDescription: o.description,
        outcomeEffort: o.effort,
        outcomeStatus: o.status,
        outcomePriorityScore: o.priorityScore,
        milestoneName: o.milestoneName,
        milestoneId: o.milestoneId,
        outcomeTags: oTags,
        motivationId: null,
        motivationTitle: null,
        motivationType: null,
        motivationScore: null,
        motivationStatus: null,
        motivationAttributes: null,
      });
    } else {
      for (const link of oLinks) {
        rows.push({
          outcomeId: o.id,
          outcomeTitle: o.title,
          outcomeDescription: o.description,
          outcomeEffort: o.effort,
          outcomeStatus: o.status,
          outcomePriorityScore: o.priorityScore,
          milestoneName: o.milestoneName,
          milestoneId: o.milestoneId,
          outcomeTags: oTags,
          motivationId: link.motivationId,
          motivationTitle: link.motivationTitle,
          motivationType: link.motivationType,
          motivationScore: link.motivationScore,
          motivationStatus: link.motivationStatus,
          motivationAttributes: link.motivationAttributes as Record<string, unknown>,
        });
      }
    }
  }

  return { rows, allAttrKeys: [...allAttrKeys].sort() };
}

// ─── Styles ───

function applyHeaderStyle(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E7E3' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
    cell.alignment = { vertical: 'top', wrapText: true };
  });
}

// ─── GET /export/timeline ───

router.get('/timeline', async (_req, res) => {
  const { rows, allAttrKeys } = await buildExportData();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'moou';
  workbook.created = new Date();

  // Group rows by milestone
  const groups = new Map<string, ExportRow[]>();
  groups.set('Backlog', []);

  for (const row of rows) {
    const key = row.milestoneName || 'Backlog';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Build columns
  const baseColumns = [
    { header: 'Outcome ID', key: 'outcomeId', width: 12 },
    { header: 'Outcome', key: 'outcomeTitle', width: 35 },
    { header: 'Description', key: 'outcomeDescription', width: 40 },
    { header: 'Effort', key: 'outcomeEffort', width: 8 },
    { header: 'Status', key: 'outcomeStatus', width: 12 },
    { header: 'Priority Score', key: 'outcomePriorityScore', width: 14 },
    { header: 'Tags', key: 'outcomeTags', width: 20 },
    { header: 'Motivation ID', key: 'motivationId', width: 12 },
    { header: 'Motivation', key: 'motivationTitle', width: 35 },
    { header: 'Motivation Type', key: 'motivationType', width: 16 },
    { header: 'Motivation Score', key: 'motivationScore', width: 14 },
    { header: 'Motivation Status', key: 'motivationStatus', width: 14 },
  ];

  const attrColumns = allAttrKeys.map(key => ({
    header: key.replace(/_/g, ' '),
    key: `attr_${key}`,
    width: 16,
  }));

  const columns = [...baseColumns, ...attrColumns];

  for (const [sheetName, sheetRows] of groups) {
    if (sheetRows.length === 0 && sheetName === 'Backlog') continue;

    const sheet = workbook.addWorksheet(sheetName.substring(0, 31)); // Excel 31 char limit
    sheet.columns = columns;
    applyHeaderStyle(sheet.getRow(1));

    // Track which rows belong to same outcome for merging
    let currentOutcomeId: string | null = null;
    let mergeStartRow = 2;

    for (let i = 0; i < sheetRows.length; i++) {
      const row = sheetRows[i]!;
      const excelRow = i + 2; // 1-indexed, row 1 is header

      const rowData: Record<string, unknown> = {
        outcomeId: row.outcomeId,
        outcomeTitle: row.outcomeTitle,
        outcomeDescription: row.outcomeDescription,
        outcomeEffort: row.outcomeEffort,
        outcomeStatus: row.outcomeStatus,
        outcomePriorityScore: Number(row.outcomePriorityScore),
        outcomeTags: row.outcomeTags,
        motivationId: row.motivationId,
        motivationTitle: row.motivationTitle,
        motivationType: row.motivationType,
        motivationScore: row.motivationScore ? Number(row.motivationScore) : null,
        motivationStatus: row.motivationStatus,
      };

      // Spread motivation attributes into attr_ columns
      if (row.motivationAttributes) {
        for (const key of allAttrKeys) {
          rowData[`attr_${key}`] = (row.motivationAttributes as Record<string, unknown>)[key] ?? null;
        }
      }

      // Sanitize all string values to prevent formula injection
      const sanitized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rowData)) {
        sanitized[k] = sanitizeCell(v);
      }
      sheet.addRow(sanitized);

      // Set alignment
      sheet.getRow(excelRow).eachCell((cell) => {
        cell.alignment = { vertical: 'top', wrapText: true };
      });

      // Merge outcome cells when outcome changes
      if (row.outcomeId !== currentOutcomeId) {
        if (currentOutcomeId && excelRow - mergeStartRow > 1) {
          // Merge outcome columns for the previous outcome group
          for (let col = 1; col <= 7; col++) { // Columns A-G (outcome fields)
            if (excelRow - 1 > mergeStartRow) {
              sheet.mergeCells(mergeStartRow, col, excelRow - 1, col);
            }
          }
        }
        currentOutcomeId = row.outcomeId;
        mergeStartRow = excelRow;
      }
    }

    // Merge last group
    if (currentOutcomeId && sheetRows.length > 0) {
      const lastRow = sheetRows.length + 1;
      if (lastRow > mergeStartRow) {
        for (let col = 1; col <= 7; col++) {
          sheet.mergeCells(mergeStartRow, col, lastRow, col);
        }
      }
    }

    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  // Generate and send
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="moou-timeline-${new Date().toISOString().split('T')[0]}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
});

// ─── GET /export/timeline/markdown ───

router.get('/timeline/markdown', async (_req, res) => {
  const { rows } = await buildExportData();

  // Group by milestone
  const groups = new Map<string, ExportRow[]>();
  for (const row of rows) {
    const key = row.milestoneName || 'Backlog';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  let md = `# moou Timeline Export\n\n*Exported ${new Date().toISOString().split('T')[0]}*\n\n`;

  for (const [milestone, milestoneRows] of groups) {
    md += `## ${escapeMarkdown(milestone)}\n\n`;

    // Group by outcome within milestone
    const outcomeGroups = new Map<string, ExportRow[]>();
    for (const row of milestoneRows) {
      if (!outcomeGroups.has(row.outcomeId)) outcomeGroups.set(row.outcomeId, []);
      outcomeGroups.get(row.outcomeId)!.push(row);
    }

    for (const [, outcomeRows] of outcomeGroups) {
      const o = outcomeRows[0]!;
      const score = Number(o.outcomePriorityScore).toLocaleString('en', { maximumFractionDigits: 0 });
      md += `### ${escapeMarkdown(o.outcomeTitle)}\n`;
      md += `**Score:** ${score} | **Effort:** ${escapeMarkdown(o.outcomeEffort) || '—'} | **Status:** ${escapeMarkdown(o.outcomeStatus)}`;
      if (o.outcomeTags) md += ` | **Tags:** ${escapeMarkdown(o.outcomeTags)}`;
      md += `\n\n`;
      if (o.outcomeDescription) md += `${escapeMarkdownBlock(o.outcomeDescription)}\n\n`;

      const motivationRows = outcomeRows.filter(r => r.motivationId);
      if (motivationRows.length > 0) {
        md += `**Motivations:**\n`;
        for (const m of motivationRows) {
          const mScore = Number(m.motivationScore || 0).toLocaleString('en', { maximumFractionDigits: 0 });
          md += `- **${escapeMarkdown(m.motivationTitle)}** (${escapeMarkdown(m.motivationType)}, score: ${mScore})`;
          if (m.motivationStatus === 'resolved') md += ` ~~resolved~~`;
          md += `\n`;
        }
        md += `\n`;
      }
    }
  }

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="moou-timeline-${new Date().toISOString().split('T')[0]}.md"`);
  res.send(md);
});

export { buildExportData };
export default router;
