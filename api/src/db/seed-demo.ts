/**
 * Seeds demo data for development — outcomes, motivations, milestones, tags, links.
 * Run after the base seed (users + motivation types).
 */
import { db } from './index.js';
import { motivationTypes, milestones, outcomes, motivations, tags, outcomeTags, motivationTags, outcomeMotivations, comments, externalLinks } from './schema.js';
import { eq } from 'drizzle-orm';
import { recalculateAll } from '../scoring/recalculate.js';

export async function seedDemo() {
  // Check if demo data already exists
  const existingOutcomes = await db.select().from(outcomes).limit(1);
  if (existingOutcomes.length > 0) {
    console.log('Demo data already seeded, skipping.');
    return;
  }

  console.log('Seeding demo data...');

  // ─── Get motivation type IDs ───
  const types = await db.select().from(motivationTypes);
  const typeId = (name: string) => types.find(t => t.name === name)!.id;

  // ─── Tags ───
  const [tSecurity] = await db.insert(tags).values({ name: 'security', emoji: '🔒', colour: '#c43c3c' }).returning() as any[];
  const [tPlatform] = await db.insert(tags).values({ name: 'platform', emoji: '🏗️', colour: '#3a8a4a' }).returning() as any[];
  const [tRevenue] = await db.insert(tags).values({ name: 'revenue', emoji: '💰', colour: '#c07a1a' }).returning() as any[];
  const [tCompliance] = await db.insert(tags).values({ name: 'compliance', emoji: '📋', colour: '#7a5ac8' }).returning() as any[];
  const [tEMEA] = await db.insert(tags).values({ name: 'EMEA', emoji: '🌍', colour: '#2a7ac8' }).returning() as any[];
  const [tMasking] = await db.insert(tags).values({ name: 'area:masking', emoji: '📦', colour: '#1a8a7a' }).returning() as any[];
  const [tQ3] = await db.insert(tags).values({ name: 'release:Q3-2026', emoji: '🚀', colour: '#a06015' }).returning() as any[];

  // ─── Milestones ───
  const [msQ2] = await db.insert(milestones).values({
    name: 'Q2 2026 Release', targetDate: '2026-06-30', type: 'release',
    status: 'active', createdBy: 'mock:james-obi',
  }).returning() as any[];

  const [msSoc2] = await db.insert(milestones).values({
    name: 'SOC2 Audit', targetDate: '2026-05-16', type: 'deadline',
    status: 'upcoming', createdBy: 'mock:sarah-chen',
  }).returning() as any[];

  const [msQ3] = await db.insert(milestones).values({
    name: 'Q3 2026 Release', targetDate: '2026-09-30', type: 'release',
    status: 'upcoming', createdBy: 'mock:james-obi',
  }).returning() as any[];

  // ─── Outcomes ───
  const [o1] = await db.insert(outcomes).values({
    title: 'Improve Data Masking Performance',
    description: '## Problem\n\nThe current masking engine struggles with datasets over **50M rows**, leading to timeouts and support escalations.\n\n## Approach\n\nRewrite the batch processor to use streaming transforms. Target: handle 500M rows within SLA.',
    effort: 'L', milestoneId: msQ2.id, status: 'active', createdBy: 'mock:sarah-chen',
  }).returning() as any[];

  const [o2] = await db.insert(outcomes).values({
    title: 'GDPR Data Residency — EU Hosting',
    description: 'Regulatory requirement under GDPR Article 44 to ensure all EU customer data is processed and stored within EU borders.',
    effort: 'XL', milestoneId: msSoc2.id, status: 'active', createdBy: 'mock:anna-mueller',
  }).returning() as any[];

  const [o3] = await db.insert(outcomes).values({
    title: 'Migrate CI/CD to GitHub Actions',
    description: 'CTO-mandated migration from Jenkins to GitHub Actions. Current infrastructure is flaky and slowing all teams.',
    effort: 'M', milestoneId: msQ3.id, status: 'approved', createdBy: 'mock:dev-patel',
  }).returning() as any[];

  const [o4] = await db.insert(outcomes).values({
    title: 'Real-Time Audit Log Streaming',
    description: 'Enterprise customers need real-time audit log streaming for SOC2 compliance and security monitoring.',
    effort: 'M', milestoneId: msQ2.id, status: 'active', createdBy: 'mock:james-obi',
  }).returning() as any[];

  const [o5] = await db.insert(outcomes).values({
    title: 'Upgrade PostgreSQL 14 → 16',
    description: 'End of life for PG14 approaching. PG16 brings performance improvements and security patches.',
    effort: 'M', milestoneId: msQ3.id, status: 'active', createdBy: 'mock:dev-patel',
  }).returning() as any[];

  const [o6] = await db.insert(outcomes).values({
    title: 'SSO for Partner Portal',
    description: 'Partners currently use basic auth. SSO would improve security and reduce onboarding friction.',
    effort: 'L', status: 'draft', createdBy: 'mock:james-obi',
  }).returning() as any[];

  const [o7] = await db.insert(outcomes).values({
    title: 'Deprecate Legacy Notification Service',
    description: 'Old notification service uses outdated patterns, costs £2K/month, nobody owns it.',
    effort: 'S', status: 'deferred', createdBy: 'mock:dev-patel',
  }).returning() as any[];

  // ─── Tag outcomes ───
  await db.insert(outcomeTags).values([
    { outcomeId: o1.id, tagId: tSecurity.id }, { outcomeId: o1.id, tagId: tPlatform.id }, { outcomeId: o1.id, tagId: tMasking.id },
    { outcomeId: o2.id, tagId: tCompliance.id }, { outcomeId: o2.id, tagId: tEMEA.id },
    { outcomeId: o3.id, tagId: tPlatform.id }, { outcomeId: o3.id, tagId: tQ3.id },
    { outcomeId: o4.id, tagId: tSecurity.id }, { outcomeId: o4.id, tagId: tRevenue.id },
    { outcomeId: o5.id, tagId: tPlatform.id },
    { outcomeId: o6.id, tagId: tRevenue.id }, { outcomeId: o6.id, tagId: tSecurity.id },
    { outcomeId: o7.id, tagId: tPlatform.id },
  ]);

  // ─── Motivations ───
  const [m1] = await db.insert(motivations).values({
    title: 'Acme Corp — masking perf blocker',
    typeId: typeId('Customer Demand'),
    attributes: { customer_name: 'Acme Corp', segment: 'enterprise', strategic_flag: true, revenue_at_risk: 1800000, revenue_opportunity: 0, deal_stage: 'renewal', target_date: '2026-04-17', impact_type: 'blocker', confidence: 0.9 },
    targetDate: '2026-04-17',
    createdBy: 'mock:james-obi',
  }).returning() as any[];

  const [m2] = await db.insert(motivations).values({
    title: 'DataFlow Inc — masking SLA breach',
    typeId: typeId('Customer Demand'),
    attributes: { customer_name: 'DataFlow Inc', segment: 'enterprise', revenue_at_risk: 500000, revenue_opportunity: 200000, deal_stage: 'live', target_date: '2026-05-30', impact_type: 'major', confidence: 0.8 },
    targetDate: '2026-05-30',
    createdBy: 'mock:james-obi',
  }).returning() as any[];

  const [m3] = await db.insert(motivations).values({
    title: 'Masking engine scaling failures',
    typeId: typeId('Tech Debt'),
    attributes: { incident_frequency: 12, performance_impact: 'critical', blast_radius: 'platform-wide', support_hours_monthly: 18, architectural_risk: 'high' },
    createdBy: 'mock:sarah-chen',
  }).returning() as any[];

  const [m4] = await db.insert(motivations).values({
    title: 'GDPR Art. 44 — data residency mandate',
    typeId: typeId('Compliance'),
    attributes: { regulation: 'GDPR Article 44', mandate_deadline: '2026-05-16', penalty_severity: 'critical', legal_exposure: 5000000, confidence: 0.95 },
    targetDate: '2026-05-16',
    createdBy: 'mock:anna-mueller',
  }).returning() as any[];

  const [m5] = await db.insert(motivations).values({
    title: 'MegaCorp EU — data must stay in EU',
    typeId: typeId('Customer Demand'),
    attributes: { customer_name: 'MegaCorp EU', segment: 'enterprise', strategic_flag: true, revenue_at_risk: 1200000, deal_stage: 'renewal', target_date: '2026-05-16', impact_type: 'blocker', confidence: 0.85 },
    targetDate: '2026-05-16',
    createdBy: 'mock:anna-mueller',
  }).returning() as any[];

  const [m6] = await db.insert(motivations).values({
    title: 'CTO mandate: migrate to GitHub Actions',
    typeId: typeId('Internal Mandate'),
    attributes: { stakeholder: 'VP Engineering', mandate_type: 'tooling', target_date: '2026-06-02', business_justification: 'Standardise on GitHub ecosystem', priority_override: 'critical' },
    targetDate: '2026-06-02',
    createdBy: 'mock:dev-patel',
  }).returning() as any[];

  const [m7] = await db.insert(motivations).values({
    title: 'Jenkins tech debt — flaky pipelines',
    typeId: typeId('Tech Debt'),
    attributes: { incident_frequency: 8, performance_impact: 'high', blast_radius: 'service', support_hours_monthly: 12, architectural_risk: 'medium' },
    createdBy: 'mock:dev-patel',
  }).returning() as any[];

  const [m8] = await db.insert(motivations).values({
    title: 'GlobalBank — audit log for SOC2',
    typeId: typeId('Customer Demand'),
    attributes: { customer_name: 'GlobalBank', segment: 'enterprise', revenue_at_risk: 800000, deal_stage: 'live', target_date: '2026-06-30', impact_type: 'major', confidence: 0.7 },
    targetDate: '2026-06-30',
    createdBy: 'mock:james-obi',
  }).returning() as any[];

  const [m9] = await db.insert(motivations).values({
    title: 'Competitor X ships real-time audit',
    typeId: typeId('Competitive Gap'),
    attributes: { competitor: 'Competitor X', gap_severity: 'table-stakes', deals_lost: 3, market_segment: 'Enterprise', confidence: 0.8 },
    createdBy: 'mock:james-obi',
  }).returning() as any[];

  const [m10] = await db.insert(motivations).values({
    title: 'BetaCo — renewal needs SSO',
    typeId: typeId('Customer Demand'),
    attributes: { customer_name: 'BetaCo', segment: 'enterprise', revenue_at_risk: 500000, deal_stage: 'renewal', target_date: '2026-08-15', impact_type: 'major', confidence: 0.6 },
    targetDate: '2026-08-15',
    createdBy: 'mock:james-obi',
  }).returning() as any[];

  // ─── Tag motivations ───
  await db.insert(motivationTags).values([
    { motivationId: m1.id, tagId: tSecurity.id }, { motivationId: m1.id, tagId: tMasking.id },
    { motivationId: m2.id, tagId: tMasking.id }, { motivationId: m2.id, tagId: tRevenue.id },
    { motivationId: m3.id, tagId: tPlatform.id }, { motivationId: m3.id, tagId: tMasking.id },
    { motivationId: m4.id, tagId: tCompliance.id }, { motivationId: m4.id, tagId: tEMEA.id },
    { motivationId: m5.id, tagId: tEMEA.id }, { motivationId: m5.id, tagId: tRevenue.id },
    { motivationId: m8.id, tagId: tSecurity.id }, { motivationId: m8.id, tagId: tRevenue.id },
    { motivationId: m9.id, tagId: tRevenue.id },
  ]);

  // ─── Link motivations to outcomes ───
  const links = [
    { outcomeId: o1.id, motivationId: m1.id }, { outcomeId: o1.id, motivationId: m2.id }, { outcomeId: o1.id, motivationId: m3.id },
    { outcomeId: o2.id, motivationId: m4.id }, { outcomeId: o2.id, motivationId: m5.id },
    { outcomeId: o3.id, motivationId: m6.id }, { outcomeId: o3.id, motivationId: m7.id },
    { outcomeId: o4.id, motivationId: m8.id }, { outcomeId: o4.id, motivationId: m9.id },
    { outcomeId: o5.id, motivationId: m3.id }, // shared — masking scaling also motivates PG upgrade
    { outcomeId: o6.id, motivationId: m10.id }, { outcomeId: o6.id, motivationId: m9.id }, // shared — competitive gap
  ];
  for (const link of links) {
    await db.insert(outcomeMotivations).values({ ...link, createdBy: 'mock:sarah-chen' });
  }

  // ─── External links ───
  await db.insert(externalLinks).values([
    { outcomeId: o1.id, provider: 'valueedge', entityType: 'epic', entityId: 'VE-1042', createdBy: 'mock:james-obi' },
    { outcomeId: o1.id, provider: 'valueedge', entityType: 'feature', entityId: 'VE-1043', createdBy: 'mock:james-obi' },
    { outcomeId: o2.id, provider: 'valueedge', entityType: 'epic', entityId: 'VE-1050', createdBy: 'mock:anna-mueller' },
    { outcomeId: o4.id, provider: 'valueedge', entityType: 'feature', entityId: 'VE-1061', createdBy: 'mock:james-obi' },
  ]);

  // ─── Comments ───
  await db.insert(comments).values([
    { outcomeId: o1.id, body: 'Spoke to Acme CTO — flexible on date if we give them beta access.', createdBy: 'mock:james-obi' },
    { outcomeId: o1.id, body: 'Engineering spike completed. Streaming approach is viable. Updated effort to L.', createdBy: 'mock:sarah-chen' },
    { outcomeId: o2.id, body: 'Legal confirmed this is P1, awaiting formal sign-off.', createdBy: 'mock:anna-mueller' },
  ]);

  // ─── Compute all scores ───
  await recalculateAll();

  console.log('Demo data seeded:');
  console.log('  7 tags, 3 milestones, 7 outcomes, 10 motivations');
  console.log('  12 links, 4 external links, 3 comments');
  console.log('  Scores recalculated.');
}
