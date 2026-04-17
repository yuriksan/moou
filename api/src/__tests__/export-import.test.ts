import { describe, it, expect } from 'vitest';
import './setup.js';
import request from 'supertest';
import { app } from '../app.js';
import ExcelJS from 'exceljs';

const USER = 'sarah-chen';
function api() {
  return {
    get: (path: string) => request(app).get(`/api${path}`).set('X-User-Id', USER),
    post: (path: string) => request(app).post(`/api${path}`),
    put: (path: string) => request(app).put(`/api${path}`),
    patch: (path: string) => request(app).patch(`/api${path}`),
    delete: (path: string) => request(app).delete(`/api${path}`),
  };
}

async function exportWorkbook(): Promise<ExcelJS.Workbook> {
  const res = await api().get('/export/timeline')
    .buffer(true)
    .parse((r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  return wb;
}

async function exportBuffer(): Promise<Buffer> {
  const res = await api().get('/export/timeline')
    .buffer(true)
    .parse((r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
  return res.body;
}

async function seedTestData() {
  const ms = await api().post('/milestones').set('X-User-Id', USER)
    .send({ name: 'Q2 Export Test', targetDate: '2026-06-30', type: 'release' });

  const o1 = await api().post('/outcomes').set('X-User-Id', USER)
    .send({ title: 'Export Outcome 1', effort: 'M', status: 'active', milestoneId: ms.body.id });

  const o2 = await api().post('/outcomes').set('X-User-Id', USER)
    .send({ title: 'Backlog Outcome', effort: 'S', status: 'draft' });

  const types = await api().get('/motivation-types');
  const cdType = types.body.find((t: any) => t.name === 'Customer Demand');

  const m1 = await api().post('/motivations').set('X-User-Id', USER)
    .send({ title: 'Test Customer', typeId: cdType.id, attributes: { customer_name: 'TestCo', revenue_at_risk: 500000, confidence: 0.8 } });

  await api().post(`/motivations/${m1.body.id}/link/${o1.body.id}`).set('X-User-Id', USER);

  return { ms: ms.body, o1: o1.body, o2: o2.body, m1: m1.body, cdType };
}

describe('Export', () => {
  it('returns a valid Excel file with Milestones, Timeline, and type sheets', async () => {
    await seedTestData();
    const wb = await exportWorkbook();
    const sheetNames = wb.worksheets.map(s => s.name);

    expect(sheetNames).toContain('Milestones');
    expect(sheetNames).toContain('Timeline');
    expect(sheetNames).toContain('Customer Demand');
    // No per-milestone sheets
    expect(sheetNames).not.toContain('Q2 Export Test');
    expect(sheetNames).not.toContain('Backlog');
  });

  it('Milestones sheet has milestone data with summary columns', async () => {
    await seedTestData();
    const wb = await exportWorkbook();
    const sheet = wb.getWorksheet('Milestones')!;

    // Check headers
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toContain('Name');
    expect(headers).toContain('Target Date');
    expect(headers).toContain('Outcomes');
    expect(headers).toContain('Avg Score');

    // Check milestone row exists
    let foundMs = false;
    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const vals = row.values as any[];
      if (vals.some(v => String(v).includes('Q2 Export Test'))) foundMs = true;
    });
    expect(foundMs).toBe(true);
  });

  it('Timeline sheet has all outcomes with milestone column and AutoFilter', async () => {
    const { o1, o2 } = await seedTestData();
    const wb = await exportWorkbook();
    const sheet = wb.getWorksheet('Timeline')!;

    // Check headers include Milestone column
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toContain('Milestone');
    expect(headers).toContain('Outcome');
    expect(headers).toContain('Effort');
    expect(headers).toContain('Motivations');

    // Both outcomes should be present
    let foundO1 = false;
    let foundO2 = false;
    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const vals = row.values as any[];
      if (vals.some(v => String(v).includes('Export Outcome 1'))) foundO1 = true;
      if (vals.some(v => String(v).includes('Backlog Outcome'))) foundO2 = true;
    });
    expect(foundO1).toBe(true);
    expect(foundO2).toBe(true);

    // AutoFilter should be set
    expect(sheet.autoFilter).toBeDefined();
  });

  it('Timeline sheet has data validation on editable cells', async () => {
    await seedTestData();
    const wb = await exportWorkbook();
    const sheet = wb.getWorksheet('Timeline')!;

    // Find column indices
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value); });
    const effortCol = headers.indexOf('Effort');
    const statusCol = headers.indexOf('Status');
    const milestoneCol = headers.indexOf('Milestone');

    // Check row 2 validation
    const row2 = sheet.getRow(2);
    expect(row2.getCell(effortCol).dataValidation).toBeDefined();
    expect(row2.getCell(effortCol).dataValidation?.type).toBe('list');
    expect(row2.getCell(statusCol).dataValidation).toBeDefined();
    expect(row2.getCell(statusCol).dataValidation?.type).toBe('list');
    expect(row2.getCell(milestoneCol).dataValidation).toBeDefined();
  });

  it('Timeline sheet has cell comment on Motivations column for outcomes with motivations', async () => {
    await seedTestData();
    const wb = await exportWorkbook();
    const sheet = wb.getWorksheet('Timeline')!;

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value); });
    const motivationsCol = headers.indexOf('Motivations');

    // Find the row for Export Outcome 1 (has a motivation)
    let commentFound = false;
    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const vals = row.values as any[];
      if (vals.some(v => String(v).includes('Export Outcome 1'))) {
        const cell = row.getCell(motivationsCol);
        if (cell.note) commentFound = true;
      }
    });
    expect(commentFound).toBe(true);
  });

  it('Motivation type sheet has type-specific attribute columns with validation', async () => {
    await seedTestData();
    const wb = await exportWorkbook();
    const sheet = wb.getWorksheet('Customer Demand')!;
    expect(sheet).toBeDefined();

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));

    // Should have Customer Demand-specific columns
    expect(headers).toContain('customer name');
    expect(headers).toContain('revenue at risk');
    expect(headers).toContain('confidence');
    expect(headers).toContain('segment');

    // Should NOT have columns from other types
    expect(headers).not.toContain('regulation');
    expect(headers).not.toContain('blast radius');

    // Check validation on enum column (segment)
    const segmentCol = headers.indexOf('segment') + 1;
    const row2 = sheet.getRow(2);
    if (row2.hasValues) {
      expect(row2.getCell(segmentCol).dataValidation?.type).toBe('list');
    }
  });

  it('read-only cells are locked while editable cells are unlocked', async () => {
    await seedTestData();
    const wb = await exportWorkbook();
    const sheet = wb.getWorksheet('Timeline')!;

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value); });
    const effortCol = headers.indexOf('Effort');
    const scoreCol = headers.indexOf('Priority Score');

    // Sheet protection should be enabled
    expect(sheet.sheetProtection).toBeDefined();

    // Editable cell (Effort) should be explicitly unlocked
    const row2 = sheet.getRow(2);
    expect(row2.getCell(effortCol).protection?.locked).toBe(false);

    // Read-only cell (Priority Score) should NOT be unlocked
    const scoreLocked = row2.getCell(scoreCol).protection?.locked;
    expect(scoreLocked === undefined || scoreLocked === true).toBe(true);
  });

  it('markdown export still works', async () => {
    await seedTestData();

    const res = await api().get('/export/timeline/markdown')
      .expect(200)
      .expect('Content-Type', /markdown/);

    const md = res.text;
    expect(md).toContain('# moou Timeline Export');
    expect(md).toContain('Export Outcome 1');
    expect(md).toContain('Test Customer');
    expect(md).toContain('Q2 Export Test');
  });

  it('escapes markdown metacharacters in user-supplied content', async () => {
    const milestone = await api().post('/milestones').set('X-User-Id', USER)
      .send({ name: 'Injection test', targetDate: '2026-12-31' });

    await api().post('/outcomes').set('X-User-Id', USER)
      .send({
        title: 'Build *new* feature [click](http://evil.com)',
        description: '## Pwned heading\n- pwned bullet\n[link](http://evil.com)',
        milestoneId: milestone.body.id,
      });

    const res = await api().get('/export/timeline/markdown').expect(200);
    const md = res.text;

    expect(md).not.toContain('[click](http://evil.com)');
    expect(md).not.toContain('\n## Pwned heading');
    expect(md).not.toContain('\n- pwned bullet');
    expect(md).toContain('Build \\*new\\*');
    expect(md).toContain('\\[click\\]');
    expect(md).toContain('\\## Pwned heading');
  });
});

describe('Import', () => {
  it('rejects old-format exports without Milestones sheet', async () => {
    await seedTestData();

    // Create a workbook in the old format (per-milestone sheets, no Milestones sheet)
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Q2 Export Test');
    sheet.addRow(['Outcome ID', 'Outcome']);
    sheet.addRow(['some-id', 'Some outcome']);

    const buf = await wb.xlsx.writeBuffer();

    const res = await api().post('/import/timeline/diff')
      .set('X-User-Id', USER)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from(buf));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FORMAT_ERROR');
    expect(res.body.error.message).toContain('older export format');
  });

  it('round-trips unchanged export with no diffs', async () => {
    await seedTestData();
    const buf = await exportBuffer();

    const res = await api().post('/import/timeline/diff')
      .set('X-User-Id', USER)
      .set('Content-Type', 'application/octet-stream')
      .send(buf);

    expect(res.status).toBe(200);
    expect(res.body.diffs).toBeDefined();
    expect(res.body.summary).toBeDefined();
    // Unchanged export should have 0 modifications (may have 0 or some due to rounding)
    expect(res.body.summary.modified).toBe(0);
    expect(res.body.summary.created).toBe(0);
    expect(res.body.summary.moved).toBe(0);
  });

  it('applies outcome changes from Timeline sheet', async () => {
    const { o1 } = await seedTestData();

    const diffs = [{
      type: 'outcome_modified',
      entityType: 'outcome',
      entityId: o1.id,
      title: 'Export Outcome 1',
      changes: { effort: { old: 'M', new: 'L' } },
      sheetName: 'Timeline',
    }];

    const res = await api().post('/import/timeline/apply')
      .set('X-User-Id', USER)
      .send({ diffs, archiveDeleted: true });

    expect(res.status).toBe(200);
    expect(res.body.applied).toHaveLength(1);
    expect(res.body.applied[0]).toContain('Updated outcome');

    const outcome = await api().get(`/outcomes/${o1.id}`);
    expect(outcome.body.effort).toBe('L');
  });

  it('applies milestone changes from Milestones sheet', async () => {
    const { ms } = await seedTestData();

    const diffs = [{
      type: 'milestone_modified',
      entityType: 'milestone',
      entityId: ms.id,
      title: 'Q2 Export Test',
      changes: { name: { old: 'Q2 Export Test', new: 'Q2 Renamed' } },
      sheetName: 'Milestones',
    }];

    const res = await api().post('/import/timeline/apply')
      .set('X-User-Id', USER)
      .send({ diffs });

    expect(res.status).toBe(200);
    expect(res.body.applied[0]).toContain('Updated milestone');
  });

  it('archives deleted outcomes', async () => {
    const { o2 } = await seedTestData();

    const diffs = [{
      type: 'outcome_deleted',
      entityType: 'outcome',
      entityId: o2.id,
      title: 'Backlog Outcome',
      changes: { title: { old: 'Backlog Outcome', new: null } },
      sheetName: 'Deleted',
    }];

    const res = await api().post('/import/timeline/apply')
      .set('X-User-Id', USER)
      .send({ diffs, archiveDeleted: true });

    expect(res.status).toBe(200);
    expect(res.body.applied[0]).toContain('Archived');

    const outcome = await api().get(`/outcomes/${o2.id}`);
    expect(outcome.body.status).toBe('archived');
  });
});
