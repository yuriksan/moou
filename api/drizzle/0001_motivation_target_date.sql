ALTER TABLE "motivations" ADD COLUMN IF NOT EXISTS "target_date" date;
--> statement-breakpoint
-- Backfill: copy the date from whichever attribute field has format:'date' in the type schema.
-- We derive it dynamically so this works for any current or future type.
UPDATE "motivations" m
SET "target_date" = (
  SELECT (
    SELECT value
    FROM jsonb_each_text(m.attributes)
    WHERE key IN (
      SELECT key
      FROM jsonb_each(mt.attribute_schema->'properties')
      WHERE value->>'format' = 'date'
    )
    LIMIT 1
  )::date
  FROM "motivation_types" mt
  WHERE mt.id = m."type_id"
)
WHERE m.attributes != '{}'::jsonb;
