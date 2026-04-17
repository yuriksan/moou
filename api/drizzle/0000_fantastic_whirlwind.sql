CREATE TABLE "backend_field_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"field_name" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outcome_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outcome_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"url" text,
	"connection_state" text DEFAULT 'connected' NOT NULL,
	"cached_details" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"change_type" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "history_entity_type_check" CHECK ("history"."entity_type" IN ('outcome', 'motivation', 'milestone', 'outcome_motivation', 'external_link')),
	CONSTRAINT "history_change_type_check" CHECK ("history"."change_type" IN ('created', 'updated', 'deleted', 'linked', 'unlinked', 'resolved', 'reopened', 'pinned', 'unpinned'))
);
--> statement-breakpoint
CREATE TABLE "milestone_tags" (
	"milestone_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "milestone_tags_milestone_id_tag_id_pk" PRIMARY KEY("milestone_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target_date" date NOT NULL,
	"type" text,
	"description" text,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "milestones_status_check" CHECK ("milestones"."status" IN ('upcoming', 'active', 'completed')),
	CONSTRAINT "milestones_type_check" CHECK ("milestones"."type" IS NULL OR "milestones"."type" IN ('release', 'deadline', 'review'))
);
--> statement-breakpoint
CREATE TABLE "motivation_tags" (
	"motivation_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "motivation_tags_motivation_id_tag_id_pk" PRIMARY KEY("motivation_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "motivation_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"attribute_schema" jsonb NOT NULL,
	"scoring_formula" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "motivation_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "motivations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" numeric(12, 2) DEFAULT '0' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "motivations_status_check" CHECK ("motivations"."status" IN ('active', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "outcome_motivations" (
	"outcome_id" uuid NOT NULL,
	"motivation_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcome_motivations_outcome_id_motivation_id_pk" PRIMARY KEY("outcome_id","motivation_id")
);
--> statement-breakpoint
CREATE TABLE "outcome_tags" (
	"outcome_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "outcome_tags_outcome_id_tag_id_pk" PRIMARY KEY("outcome_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"effort" text,
	"milestone_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"priority_score" numeric(12, 2) DEFAULT '0' NOT NULL,
	"primary_link_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_status_check" CHECK ("outcomes"."status" IN ('draft', 'active', 'approved', 'deferred', 'completed', 'archived')),
	CONSTRAINT "outcomes_effort_check" CHECK ("outcomes"."effort" IS NULL OR "outcomes"."effort" IN ('XS', 'S', 'M', 'L', 'XL'))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"emoji" text,
	"colour" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"provider_id" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"initials" text NOT NULL,
	"avatar_url" text
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_links" ADD CONSTRAINT "external_links_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_links" ADD CONSTRAINT "external_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history" ADD CONSTRAINT "history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_tags" ADD CONSTRAINT "milestone_tags_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_tags" ADD CONSTRAINT "milestone_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motivation_tags" ADD CONSTRAINT "motivation_tags_motivation_id_motivations_id_fk" FOREIGN KEY ("motivation_id") REFERENCES "public"."motivations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motivation_tags" ADD CONSTRAINT "motivation_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motivations" ADD CONSTRAINT "motivations_type_id_motivation_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."motivation_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motivations" ADD CONSTRAINT "motivations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_motivations" ADD CONSTRAINT "outcome_motivations_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_motivations" ADD CONSTRAINT "outcome_motivations_motivation_id_motivations_id_fk" FOREIGN KEY ("motivation_id") REFERENCES "public"."motivations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_motivations" ADD CONSTRAINT "outcome_motivations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_tags" ADD CONSTRAINT "outcome_tags_outcome_id_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_tags" ADD CONSTRAINT "outcome_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_primary_link_id_external_links_id_fk" FOREIGN KEY ("primary_link_id") REFERENCES "public"."external_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backend_field_config_unique_idx" ON "backend_field_config" USING btree ("provider","entity_type","field_name");--> statement-breakpoint
CREATE INDEX "comments_outcome_id_idx" ON "comments" USING btree ("outcome_id");--> statement-breakpoint
CREATE INDEX "external_links_outcome_id_idx" ON "external_links" USING btree ("outcome_id");--> statement-breakpoint
CREATE INDEX "external_links_provider_idx" ON "external_links" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "history_entity_lookup_idx" ON "history" USING btree ("entity_type","entity_id","changed_at");--> statement-breakpoint
CREATE INDEX "milestones_target_date_idx" ON "milestones" USING btree ("target_date");--> statement-breakpoint
CREATE INDEX "motivations_type_id_idx" ON "motivations" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "motivations_score_idx" ON "motivations" USING btree ("score");--> statement-breakpoint
CREATE INDEX "outcomes_milestone_id_idx" ON "outcomes" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "outcomes_created_by_idx" ON "outcomes" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "outcomes_priority_sort_idx" ON "outcomes" USING btree ("pinned","priority_score","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_lower_idx" ON "tags" USING btree (lower("name"));