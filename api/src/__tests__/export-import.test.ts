import { describe, it, expect } from 'vitest';
import './setup.js';
import request from 'supertest';
import { app } from '../app.js';
import ExcelJS from 'exceljs';

const USER = 'sarah-chen';
function api() {
  return {
    get: (path: string) => request(app).get(`/api${path}`),
    post: (path: string) => request(app).post(`/api${path}`),
    put: (path: string) => request(app).put(`/api${path}`),
    patch: (path: string) => request(app).patch(`/api${path}`),
    delete: (path: string) => request(app).delete(`/api${path}`),
  };
}

// Helper: create test data
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

  return { ms: ms.body, o1: o1.body, o2: o2.body, m1: m1.body };
}

describe('Export', () => {
  it('GET /export/timeline returns valid Excel file', async () => {
    await seedTestData();

    const res = await api().get('/export/timeline')
      .expect(200)
      .expect('Content-Type', /spreadsheetml/)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(Buffer.isBuffer(res.body)).toBe(true);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    expect(workbook.worksheets.length).toBeGreaterThanOrEqual(1);

    // Should have a sheet for the milestone
    const sheetNames = workbook.worksheets.map(s => s.name);
    expect(sheetNames).toContain('Q2 Export Test');
  });

  it('GET /export/timeline/markdown returns markdown', async () => {
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

  it('Excel contains outcome and motivation data', async () => {
    const { o1, m1 } = await seedTestData();

    const res = await api().get('/export/timeline')
      .buffer(true)
      .parse((r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);

    const sheet = workbook.getWorksheet('Q2 Export Test')!;
    expect(sheet).toBeDefined();

    // Find the outcome row
    let foundOutcome = false;
    let foundMotivation = false;
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header
      const values = row.values as any[];
      // Check for outcome title (column 2)
      if (values.some(v => String(v).includes('Export Outcome 1'))) foundOutcome = true;
      if (values.some(v => String(v).includes('Test Customer'))) foundMotivation = true;
    });

    expect(foundOutcome).toBe(true);
    expect(foundMotivation).toBe(true);
  });
});

describe('Import', () => {
  it('POST /import/timeline/diff accepts an uploaded spreadsheet and returns diffs', async () => {
    await seedTestData();

    // Export, then re-import unchanged — should detect no modifications
    const exportRes = await api().get('/export/timeline')
      .buffer(true)
      .parse((r: any, cb: any) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });

    const res = await api().post('/import/timeline/diff')
      .set('X-User-Id', USER)
      .set('Content-Type', 'application/octet-stream')
      .send(exportRes.body);

    expect(res.status).toBe(200);
    expect(res.body.diffs).toBeDefined();
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.total).toBeTypeOf('number');
  });

  it('POST /import/timeline/apply applies selected changes', async () => {
    const { o1 } = await seedTestData();

    const diffs = [{
      type: 'outcome_modified',
      entityType: 'outcome',
      entityId: o1.id,
      title: 'Export Outcome 1',
      changes: { effort: { old: 'M', new: 'L' } },
      sheetName: 'Q2 Export Test',
    }];

    const res = await api().post('/import/timeline/apply')
      .set('X-User-Id', USER)
      .send({ diffs, archiveDeleted: true });

    expect(res.status).toBe(200);
    expect(res.body.applied).toHaveLength(1);
    expect(res.body.applied[0]).toContain('Updated outcome');

    // Verify the change was applied
    const outcome = await api().get(`/outcomes/${o1.id}`);
    expect(outcome.body.effort).toBe('L');
  });

  it('POST /import/timeline/apply archives deleted outcomes', async () => {
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

    // Should still exist but be archived
    const outcome = await api().get(`/outcomes/${o2.id}`);
    expect(outcome.body.status).toBe('archived');
  });
});
