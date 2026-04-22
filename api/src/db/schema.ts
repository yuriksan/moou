import {
  pgTable, text, uuid, boolean, numeric, jsonb, timestamp, date,
  primaryKey, uniqueIndex, index, check, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

// ─── Helper: case-insensitive index ───
function lower(col: AnyPgColumn): SQL {
  return sql`lower(${col})`;
}

// ─── Users ───
export const users = pgTable('users', {
  id: text('id').primaryKey(), // format: "provider:providerId" e.g. "github:12345" or "mock:sarah-chen"
  provider: text('provider').notNull().default('mock'),
  providerId: text('provider_id').notNull().default(''),
  name: text('name').notNull(),
  role: text('role'),
  initials: text('initials').notNull(),
  avatarUrl: text('avatar_url'),
});

// ─── Motivation Types ───
export const motivationTypes = pgTable('motivation_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  attributeSchema: jsonb('attribute_schema').notNull().$type<Record<string, unknown>>(),
  scoringFormula: text('scoring_formula').notNull(),
  scoringDescription: text('scoring_description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── Tags ───
export const tags = pgTable('tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  emoji: text('emoji'),
  colour: text('colour'),
  description: text('description'),
}, (table) => [
  uniqueIndex('tags_name_lower_idx').on(lower(table.name)),
]);

// ─── Milestones ───
export const milestones = pgTable('milestones', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  targetDate: date('target_date').notNull(),
  type: text('type'),
  description: text('description'),
  status: text('status').notNull().default('upcoming'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('milestones_status_check', sql`${table.status} IN ('upcoming', 'active', 'completed')`),
  check('milestones_type_check', sql`${table.type} IS NULL OR ${table.type} IN ('release', 'deadline', 'review')`),
  index('milestones_target_date_idx').on(table.targetDate),
]);

// ─── Outcomes ───
export const outcomes = pgTable('outcomes', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  descriptionFormat: text('description_format').notNull().default('plain'),
  effort: text('effort'),
  milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  pinned: boolean('pinned').notNull().default(false),
  priorityScore: numeric('priority_score', { precision: 12, scale: 2 }).notNull().default('0'),
  primaryLinkId: uuid('primary_link_id').references((): AnyPgColumn => externalLinks.id, { onDelete: 'set null' }),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('outcomes_status_check', sql`${table.status} IN ('draft', 'active', 'approved', 'deferred', 'completed', 'archived')`),
  check('outcomes_effort_check', sql`${table.effort} IS NULL OR ${table.effort} IN ('XS', 'S', 'M', 'L', 'XL')`),
  check('outcomes_description_format_check', sql`${table.descriptionFormat} IN ('plain', 'html', 'markdown')`),
  index('outcomes_milestone_id_idx').on(table.milestoneId),
  index('outcomes_created_by_idx').on(table.createdBy),
  index('outcomes_priority_sort_idx').on(table.pinned, table.priorityScore, table.createdAt),
]);

// ─── Motivations ───
export const motivations = pgTable('motivations', {
  id: uuid('id').defaultRandom().primaryKey(),
  typeId: uuid('type_id').notNull().references(() => motivationTypes.id),
  title: text('title').notNull(),
  status: text('status').notNull().default('active'),
  notes: text('notes'),
  attributes: jsonb('attributes').notNull().default({}).$type<Record<string, unknown>>(),
  targetDate: date('target_date'),
  score: numeric('score', { precision: 12, scale: 2 }).notNull().default('0'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('motivations_status_check', sql`${table.status} IN ('active', 'resolved')`),
  index('motivations_type_id_idx').on(table.typeId),
  index('motivations_score_idx').on(table.score),
]);

// ─── Join: Outcome <-> Motivation ───
export const outcomeMotivations = pgTable('outcome_motivations', {
  outcomeId: uuid('outcome_id').notNull().references(() => outcomes.id, { onDelete: 'cascade' }),
  motivationId: uuid('motivation_id').notNull().references(() => motivations.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.outcomeId, table.motivationId] }),
]);

// ─── Join: Outcome <-> Tag ───
export const outcomeTags = pgTable('outcome_tags', {
  outcomeId: uuid('outcome_id').notNull().references(() => outcomes.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.outcomeId, table.tagId] }),
]);

// ─── Join: Motivation <-> Tag ───
export const motivationTags = pgTable('motivation_tags', {
  motivationId: uuid('motivation_id').notNull().references(() => motivations.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.motivationId, table.tagId] }),
]);

// ─── Join: Milestone <-> Tag ───
export const milestoneTags = pgTable('milestone_tags', {
  milestoneId: uuid('milestone_id').notNull().references(() => milestones.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.milestoneId, table.tagId] }),
]);

// ─── External Links (ValueEdge, GitHub, Jira, etc.) ───
export const externalLinks = pgTable('external_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  outcomeId: uuid('outcome_id').notNull().references((): AnyPgColumn => outcomes.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // 'valueedge', 'github', 'jira', etc.
  entityType: text('entity_type').notNull(), // provider-specific: epic/feature/story, issue/pr, etc.
  entityId: text('entity_id').notNull(),
  url: text('url'),
  connectionState: text('connection_state').notNull().default('connected'), // 'connected' or 'published'
  cachedDetails: jsonb('cached_details').$type<Record<string, unknown>>(), // title, state, labels, assignee, etag, fetchedAt
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('external_links_outcome_id_idx').on(table.outcomeId),
  index('external_links_provider_idx').on(table.provider),
]);

// ─── Comments ───
export const comments = pgTable('comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  outcomeId: uuid('outcome_id').notNull().references(() => outcomes.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('comments_outcome_id_idx').on(table.outcomeId),
]);

// ─── History ───
export const history = pgTable('history', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  changeType: text('change_type').notNull(),
  changes: jsonb('changes').notNull().default({}).$type<Record<string, { old: unknown; new: unknown }>>(),
  changedBy: text('changed_by').notNull().references(() => users.id),
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check('history_entity_type_check', sql`${table.entityType} IN ('outcome', 'motivation', 'milestone', 'outcome_motivation', 'external_link')`),
  check('history_change_type_check', sql`${table.changeType} IN ('created', 'updated', 'deleted', 'linked', 'unlinked', 'resolved', 'reopened', 'pinned', 'unpinned')`),
  index('history_entity_lookup_idx').on(table.entityType, table.entityId, table.changedAt),
]);

// ─── Backend Field Config ───
export const backendFieldConfig = pgTable('backend_field_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  provider: text('provider').notNull(),
  entityType: text('entity_type').notNull(),
  fieldName: text('field_name').notNull(),
  required: boolean('required').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('backend_field_config_unique_idx').on(table.provider, table.entityType, table.fieldName),
]);

