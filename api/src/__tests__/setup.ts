import { beforeAll, afterAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { seed } from '../db/seed.js';

// Make sure NODE_ENV is 'test' before app.ts is imported anywhere — the
// rate limiter middleware uses this to skip during tests.
process.env.NODE_ENV = 'test';

const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://moou:moou@localhost:5432/moou_test';

const pool = new pg.Pool({ connectionString: TEST_DB_URL });
export const testDb = drizzle(pool, { schema });

// Push schema to test DB (using drizzle-kit push would be ideal but we'll do it manually)
beforeAll(async () => {
  // Drop and recreate all tables
  await pool.query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
  `);

  // Create tables via raw SQL derived from schema
  await pool.query(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'mock',
      provider_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      role TEXT,
      initials TEXT NOT NULL,
      avatar_url TEXT
    );

    CREATE TABLE motivation_types (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      attribute_schema JSONB NOT NULL,
      scoring_formula TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      emoji TEXT,
      colour TEXT,
      description TEXT
    );
    CREATE UNIQUE INDEX tags_name_lower_idx ON tags (lower(name));

    CREATE TABLE milestones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      target_date DATE NOT NULL,
      type TEXT CHECK (type IS NULL OR type IN ('release', 'deadline', 'review')),
      description TEXT,
      status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed')),
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE outcomes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      effort TEXT CHECK (effort IS NULL OR effort IN ('XS', 'S', 'M', 'L', 'XL')),
      milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'approved', 'deferred', 'completed', 'archived')),
      pinned BOOLEAN NOT NULL DEFAULT false,
      priority_score NUMERIC(12,2) NOT NULL DEFAULT 0,
      primary_link_id UUID,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE motivations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type_id UUID NOT NULL REFERENCES motivation_types(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
      notes TEXT,
      attributes JSONB NOT NULL DEFAULT '{}',
      target_date DATE,
      score NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE outcome_motivations (
      outcome_id UUID NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
      motivation_id UUID NOT NULL REFERENCES motivations(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (outcome_id, motivation_id)
    );

    CREATE TABLE outcome_tags (
      outcome_id UUID NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (outcome_id, tag_id)
    );

    CREATE TABLE motivation_tags (
      motivation_id UUID NOT NULL REFERENCES motivations(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (motivation_id, tag_id)
    );

    CREATE TABLE milestone_tags (
      milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (milestone_id, tag_id)
    );

    CREATE TABLE external_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      outcome_id UUID NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      url TEXT,
      connection_state TEXT NOT NULL DEFAULT 'connected',
      cached_details JSONB,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE outcomes
      ADD CONSTRAINT outcomes_primary_link_id_fkey
      FOREIGN KEY (primary_link_id) REFERENCES external_links(id) ON DELETE SET NULL;

    CREATE TABLE comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      outcome_id UUID NOT NULL REFERENCES outcomes(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE history (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL CHECK (entity_type IN ('outcome', 'motivation', 'milestone', 'outcome_motivation', 'external_link')),
      entity_id UUID NOT NULL,
      change_type TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'deleted', 'linked', 'unlinked', 'resolved', 'reopened', 'pinned', 'unpinned')),
      changes JSONB NOT NULL DEFAULT '{}',
      changed_by TEXT NOT NULL REFERENCES users(id),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE backend_field_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      field_name TEXT NOT NULL,
      required BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (provider, entity_type, field_name)
    );
  `);

  // Seed users and motivation types
  await seed();
}, 30000);

// Clean data between tests (keep users and motivation_types)
beforeEach(async () => {
  await pool.query(`
    DELETE FROM history;
    DELETE FROM comments;
    DELETE FROM external_links;
    DELETE FROM outcome_motivations;
    DELETE FROM outcome_tags;
    DELETE FROM motivation_tags;
    DELETE FROM milestone_tags;
    DELETE FROM motivations;
    DELETE FROM outcomes;
    DELETE FROM milestones;
    DELETE FROM tags;
    DELETE FROM backend_field_config;
  `);
});

afterAll(async () => {
  await pool.end();
});
