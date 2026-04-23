import { db } from './index.js';
import { users, motivationTypes } from './schema.js';
import { count, eq, isNull, and } from 'drizzle-orm';

// ─── Mock Users ───
const MOCK_USERS = [
  { id: 'mock:sarah-chen', provider: 'mock', providerId: 'sarah-chen', name: 'Sarah Chen', jobTitle: 'Director of Engineering', role: 'admin' as const, initials: 'SC' },
  { id: 'mock:james-obi', provider: 'mock', providerId: 'james-obi', name: 'James Obi', jobTitle: 'Senior Product Manager', role: 'modifier' as const, initials: 'JO' },
  { id: 'mock:dev-patel', provider: 'mock', providerId: 'dev-patel', name: 'Dev Patel', jobTitle: 'Engineering Lead', role: 'modifier' as const, initials: 'DP' },
  { id: 'mock:anna-mueller', provider: 'mock', providerId: 'anna-mueller', name: 'Anna Müller', jobTitle: 'Product Manager', role: 'viewer' as const, initials: 'AM' },
];

// ─── Motivation Types with JSON Schema 2020-12 ───
const MOTIVATION_TYPES = [
  {
    name: 'Customer Demand',
    description: 'Customer-driven requirements linked to revenue and retention',
    attributeSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        customer_name: { type: 'string' },
        segment: { type: 'string', enum: ['enterprise', 'SMB', 'partner', 'internal'] },
        strategic_flag: { type: 'boolean' },
        revenue_at_risk: { type: 'number', minimum: 0 },
        revenue_opportunity: { type: 'number', minimum: 0 },
        deal_stage: { type: 'string', enum: ['live', 'renewal', 'prospect'] },
        target_date: { type: 'string', format: 'date' },
        impact_type: { type: 'string', enum: ['blocker', 'major', 'minor'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      additionalProperties: false,
    },
    scoringFormula: '(k(revenue_at_risk) * date_urgency(target_date) * confidence) + (k(revenue_opportunity) * strategic_weight(strategic_flag) * confidence)',
    scoringDescription: 'Revenue at risk (÷1000) × deadline urgency × confidence, plus revenue opportunity (÷1000) × strategic weight × confidence',
  },
  {
    name: 'Compliance',
    description: 'Regulatory and compliance requirements with legal exposure',
    attributeSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        regulation: { type: 'string' },
        mandate_deadline: { type: 'string', format: 'date' },
        penalty_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        legal_exposure: { type: 'number', minimum: 0 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      additionalProperties: false,
    },
    scoringFormula: 'k(legal_exposure) * date_urgency(mandate_deadline) * severity_weight(penalty_severity) * confidence',
    scoringDescription: 'Legal exposure (÷1000) × deadline urgency × penalty severity × confidence',
  },
  {
    name: 'Tech Debt',
    description: 'Technical debt, operational burden, and architectural risk',
    attributeSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        incident_frequency: { type: 'number', minimum: 0 },
        performance_impact: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        blast_radius: { type: 'string', enum: ['platform-wide', 'service', 'component'] },
        support_hours_monthly: { type: 'number', minimum: 0 },
        architectural_risk: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      },
      additionalProperties: false,
    },
    scoringFormula: '(incident_frequency * blast_radius_weight(blast_radius)) + (support_hours_monthly * 10) + severity_weight(performance_impact) * severity_weight(architectural_risk)',
    scoringDescription: 'Incident frequency × blast radius, plus support hours × 10, plus performance impact × architectural risk',
  },
  {
    name: 'Internal Mandate',
    description: 'Internally mandated work from leadership or strategy',
    attributeSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        stakeholder: { type: 'string' },
        mandate_type: { type: 'string', enum: ['tooling', 'process', 'security', 'strategy'] },
        target_date: { type: 'string', format: 'date' },
        business_justification: { type: 'string' },
        priority_override: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      },
      additionalProperties: false,
    },
    scoringFormula: 'override_weight(priority_override) * date_urgency(target_date)',
    scoringDescription: 'Priority override weight × deadline urgency',
  },
  {
    name: 'Competitive Gap',
    description: 'Feature gaps relative to competitors causing lost deals',
    attributeSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        competitor: { type: 'string' },
        gap_severity: { type: 'string', enum: ['table-stakes', 'differentiator', 'nice-to-have'] },
        deals_lost: { type: 'number', minimum: 0 },
        market_segment: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      additionalProperties: false,
    },
    scoringFormula: 'deals_lost * gap_weight(gap_severity) * confidence',
    scoringDescription: 'Deals lost × gap severity × confidence',
  },
];

export async function seed() {
  // Check if already seeded
  const [typeCount] = await db.select({ value: count() }).from(motivationTypes);
  if (typeCount && typeCount.value > 0) {
    // Backfill scoring descriptions for existing DBs
    for (const mt of MOTIVATION_TYPES) {
      await db.update(motivationTypes)
        .set({ scoringDescription: mt.scoringDescription })
        .where(and(eq(motivationTypes.name, mt.name), isNull(motivationTypes.scoringDescription)));
    }
    console.log('Database already seeded, backfill checked.');
    return;
  }

  console.log('Seeding database...');

  // Insert users
  for (const user of MOCK_USERS) {
    await db.insert(users).values(user).onConflictDoNothing();
  }
  console.log(`  ${MOCK_USERS.length} users seeded`);

  // Insert motivation types
  for (const mt of MOTIVATION_TYPES) {
    await db.insert(motivationTypes).values(mt);
  }
  console.log(`  ${MOTIVATION_TYPES.length} motivation types seeded`);

  console.log('Seed complete.');
}
