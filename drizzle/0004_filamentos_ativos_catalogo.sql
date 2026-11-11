CREATE TABLE `filamento_ativo` (
	`impressora_id` integer NOT NULL,
	`posicao` integer NOT NULL,
	`rolo_id` integer NOT NULL,
	PRIMARY KEY(`impressora_id`, `posicao`),
	FOREIGN KEY (`impressora_id`) REFERENCES `impressora`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rolo_id`) REFERENCES `rolo`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "filamento_ativo_posicao_valida" CHECK("filamento_ativo"."posicao" in (1, 2, 3, 4))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filamento_ativo_rolo_id_unique` ON `filamento_ativo` (`rolo_id`);--> statement-breakpoint
ALTER TABLE `rolo` ADD `catalogo_item_id` text;--> statement-breakpoint
-- Uma associação descreve o carregamento atual. Encerrar o rolo remove esse
-- carregamento; reabrir o cadastro não significa recolocá-lo na impressora.
-- O trigger cobre todas as actions que atualizam status, sem duplicar a regra.
CREATE TRIGGER `filamento_ativo_apos_encerrar_rolo`
AFTER UPDATE OF `status` ON `rolo`
WHEN NEW.`status` IN ('vazio', 'descartado')
BEGIN
	DELETE FROM `filamento_ativo` WHERE `rolo_id` = NEW.`id`;
END;
--> statement-breakpoint
-- Reativar uma impressora também exige escolher seus filamentos novamente.
-- Somente os vínculos daquela máquina são removidos; rolos e custos persistem.
CREATE TRIGGER `filamento_ativo_apos_desativar_impressora`
AFTER UPDATE OF `ativa` ON `impressora`
WHEN NEW.`ativa` = 0
BEGIN
	DELETE FROM `filamento_ativo` WHERE `impressora_id` = NEW.`id`;
END;
