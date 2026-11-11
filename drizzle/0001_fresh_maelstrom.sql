ALTER TABLE `config` ADD `token_nuvem` text;--> statement-breakpoint
ALTER TABLE `config` ADD `ultima_importacao_em` integer;--> statement-breakpoint
ALTER TABLE `filamento` ADD `codigo_bambu` text;--> statement-breakpoint
ALTER TABLE `filamento` ADD `fonte_catalogo` text DEFAULT 'manual' NOT NULL;