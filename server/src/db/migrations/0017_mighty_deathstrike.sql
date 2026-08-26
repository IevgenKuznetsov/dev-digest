CREATE TABLE "eval_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"agent_version" integer NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"traces_total" integer,
	"traces_passed" integer,
	"cost_usd" double precision,
	"duration_ms" integer
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN IF NOT EXISTS "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN IF NOT EXISTS "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN IF NOT EXISTS "error" text;--> statement-breakpoint
ALTER TABLE "eval_batches" ADD CONSTRAINT "eval_batches_owner_id_agents_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_source_finding_id_findings_id_fk" FOREIGN KEY ("source_finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_batch_id_eval_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."eval_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_batches_active_per_owner" ON "eval_batches" ("owner_id") WHERE status IN ('queued', 'running');--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "manifest_version" text;
