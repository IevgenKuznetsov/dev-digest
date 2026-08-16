ALTER TABLE "onboarding" ADD COLUMN "model" text DEFAULT 'deepseek/deepseek-v4-flash' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "input_sha" text;