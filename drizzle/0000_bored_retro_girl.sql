CREATE TABLE `credit_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 100 NOT NULL,
	`lifetime_spent` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `signal_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`symbol` text NOT NULL,
	`timeframe` text NOT NULL,
	`credit_cost` integer NOT NULL,
	`direction` text NOT NULL,
	`score` integer NOT NULL,
	`confidence` integer NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_analyses_user_created_idx` ON `signal_analyses` (`user_id`,`created_at`);
