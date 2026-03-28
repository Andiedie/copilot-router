ALTER TABLE `requests` ADD `model` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `endpoint` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `requests` ADD `output_tokens` integer;--> statement-breakpoint
CREATE INDEX `idx_requests_model` ON `requests` (`model`);