CREATE TABLE `model_pricing` (
	`id` text PRIMARY KEY NOT NULL,
	`copilot_model_name` text NOT NULL,
	`openrouter_model_id` text,
	`display_name` text,
	`prompt_price` text NOT NULL,
	`completion_price` text NOT NULL,
	`cache_read_price` text,
	`source` text NOT NULL,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_pricing_copilot_model_name_unique` ON `model_pricing` (`copilot_model_name`);--> statement-breakpoint
CREATE INDEX `idx_model_pricing_copilot_name` ON `model_pricing` (`copilot_model_name`);