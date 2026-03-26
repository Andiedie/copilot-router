CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`github_login` text,
	`oauth_token` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`copilot_plan` text,
	`quota_limit` integer DEFAULT 0 NOT NULL,
	`quota_used` integer DEFAULT 0 NOT NULL,
	`quota_reset_at` integer,
	`auto_disable_threshold` integer DEFAULT 10 NOT NULL,
	`last_used_at` integer,
	`error_msg` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`total_requests` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `quota_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`used` integer NOT NULL,
	`limit` integer NOT NULL,
	`remaining` integer NOT NULL,
	`captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_id` text NOT NULL,
	`account_id` text,
	`model` text,
	`endpoint` text,
	`status_code` integer,
	`duration_ms` integer,
	`is_premium` integer DEFAULT 0 NOT NULL,
	`ratelimit_remaining` integer,
	`ratelimit_limit` integer,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_requests_api_key_id` ON `requests` (`api_key_id`);--> statement-breakpoint
CREATE INDEX `idx_requests_account_id` ON `requests` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_requests_model` ON `requests` (`model`);--> statement-breakpoint
CREATE INDEX `idx_requests_created_at` ON `requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_requests_status_code` ON `requests` (`status_code`);