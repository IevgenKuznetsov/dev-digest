ALTER TABLE "ci_installations" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "commit_sha" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "manifest_version" text;