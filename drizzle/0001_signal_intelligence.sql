CREATE TABLE `kv_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signal_rate_limits` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_run_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `signal_analyses` ADD `mark` real;
--> statement-breakpoint
ALTER TABLE `signal_analyses` ADD `stop_loss` real;
--> statement-breakpoint
ALTER TABLE `signal_analyses` ADD `take_profit` real;
--> statement-breakpoint
ALTER TABLE `signal_analyses` ADD `resolve_at` integer;
--> statement-breakpoint
ALTER TABLE `signal_analyses` ADD `resolved` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `signal_analyses` ADD `hit` integer;
--> statement-breakpoint
ALTER TABLE `signal_analyses` ADD `resolved_at` integer;
--> statement-breakpoint
ALTER TABLE `signal_analyses` ADD `resolved_price` real;
--> statement-breakpoint
ALTER TABLE `signal_analyses` ADD `resolution_reason` text;
--> statement-breakpoint
ALTER TABLE `signal_analyses` ADD `actionable` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `credit_accounts` ADD `last_free_claim_date` text;
--> statement-breakpoint
ALTER TABLE `credit_accounts` ADD `streak_days` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `signal_analyses_resolve_idx` ON `signal_analyses` (`resolved`,`resolve_at`);
