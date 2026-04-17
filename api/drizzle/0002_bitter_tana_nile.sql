ALTER TABLE "motivation_types" ADD COLUMN IF NOT EXISTS "scoring_description" text;--> statement-breakpoint
ALTER TABLE "motivations" ADD COLUMN IF NOT EXISTS "target_date" date;