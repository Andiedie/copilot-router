CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`github_login` text,
	`oauth_token` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`quota_limit` integer DEFAULT 0 NOT NULL,
	`quota_used` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`total_requests` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_id` text NOT NULL,
	`account_id` text,
	`model` text,
	`status_code` integer,
	`duration_ms` integer,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_requests_api_key_id` ON `requests` (`api_key_id`);--> statement-breakpoint
CREATE INDEX `idx_requests_account_id` ON `requests` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_requests_model` ON `requests` (`model`);--> statement-breakpoint
CREATE INDEX `idx_requests_created_at` ON `requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_requests_status_code` ON `requests` (`status_code`);