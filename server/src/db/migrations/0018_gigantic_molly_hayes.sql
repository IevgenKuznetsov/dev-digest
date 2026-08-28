DROP INDEX IF EXISTS "eval_batches_owner_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "eval_runs_batch_id_idx";--> statement-breakpoint
ALTER TABLE "eval_batches" ALTER COLUMN "owner_kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "multi_agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "agent_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_multi_agent_run_id_multi_agent_runs_id_fk" FOREIGN KEY ("multi_agent_run_id") REFERENCES "public"."multi_agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_runs_multi_agent_run_id" ON "agent_runs" ("multi_agent_run_id");