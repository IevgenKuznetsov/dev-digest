CREATE TABLE "pr_risk_brief" (
	"pr_id" uuid NOT NULL,
	"head_sha" text NOT NULL,
	"brief" jsonb NOT NULL,
	"model" text NOT NULL,
	"sources" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pr_risk_brief_pr_id_head_sha_pk" PRIMARY KEY("pr_id","head_sha")
);
--> statement-breakpoint
ALTER TABLE "pr_risk_brief" ADD CONSTRAINT "pr_risk_brief_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;