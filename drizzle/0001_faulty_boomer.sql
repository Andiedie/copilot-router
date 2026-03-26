DROP TABLE `quota_snapshots`;--> statement-breakpoint
ALTER TABLE `requests` DROP COLUMN `is_premium`;--> statement-breakpoint
ALTER TABLE `requests` DROP COLUMN `ratelimit_remaining`;--> statement-breakpoint
ALTER TABLE `requests` DROP COLUMN `ratelimit_limit`;
