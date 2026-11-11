CREATE TABLE `afericao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rolo_id` integer NOT NULL,
	`peso_liquido_g` real NOT NULL,
	`data_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`observacao` text,
	FOREIGN KEY (`rolo_id`) REFERENCES `rolo`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `config` (
	`id` integer PRIMARY KEY NOT NULL,
	`tarifa_kwh_cents` integer DEFAULT 95 NOT NULL,
	`moeda` text DEFAULT 'BRL' NOT NULL,
	`formato_data_print` text DEFAULT 'MDY' NOT NULL,
	`rateio_falhas` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `filamento` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`marca` text NOT NULL,
	`material` text NOT NULL,
	`cor` text NOT NULL,
	`cor_hex` text,
	`densidade` real DEFAULT 1.24 NOT NULL,
	`temp_bico` integer,
	`temp_mesa` integer,
	`notas` text,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `impressao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`peca_id` integer,
	`nome_livre` text NOT NULL,
	`impressora_id` integer NOT NULL,
	`rolo_id` integer NOT NULL,
	`inicio_em` integer NOT NULL,
	`fim_em` integer,
	`duracao_s` integer NOT NULL,
	`gramas` real NOT NULL,
	`status` text DEFAULT 'sucesso' NOT NULL,
	`motivo_falha` text,
	`camada_mm` real,
	`paredes` integer,
	`infill_pct` integer,
	`bico_mm` real,
	`placa_build` text,
	`finalidade` text DEFAULT 'outro' NOT NULL,
	`imagem_path` text,
	`origem` text DEFAULT 'manual' NOT NULL,
	`task_id_nuvem` text,
	`observacoes` text,
	`custo_filamento_cents` integer DEFAULT 0 NOT NULL,
	`custo_energia_cents` integer DEFAULT 0 NOT NULL,
	`custo_depreciacao_cents` integer DEFAULT 0 NOT NULL,
	`custo_manutencao_cents` integer DEFAULT 0 NOT NULL,
	`custo_total_cents` integer DEFAULT 0 NOT NULL,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`peca_id`) REFERENCES `peca`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`impressora_id`) REFERENCES `impressora`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rolo_id`) REFERENCES `rolo`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `impressao_task_id_nuvem_unique` ON `impressao` (`task_id_nuvem`);--> statement-breakpoint
CREATE TABLE `impressora` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`modelo` text NOT NULL,
	`apelido_bambu` text,
	`preco_compra_cents` integer DEFAULT 0 NOT NULL,
	`data_compra` integer,
	`vida_util_horas` integer DEFAULT 5000 NOT NULL,
	`potencia_media_w` integer DEFAULT 100 NOT NULL,
	`ativa` integer DEFAULT true NOT NULL,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `manutencao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`impressora_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`descricao` text,
	`custo_cents` integer DEFAULT 0 NOT NULL,
	`horimetro_horas` real DEFAULT 0 NOT NULL,
	`data_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`impressora_id`) REFERENCES `impressora`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `peca` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`fonte_url` text,
	`finalidade_padrao` text,
	`notas` text,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rolo` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filamento_id` integer NOT NULL,
	`apelido` text,
	`preco_pago_cents` integer DEFAULT 0 NOT NULL,
	`peso_liquido_inicial_g` real DEFAULT 1000 NOT NULL,
	`peso_carretel_g` real DEFAULT 250 NOT NULL,
	`fornecedor` text,
	`data_compra` integer,
	`data_abertura` integer,
	`data_ultima_secagem` integer,
	`status` text DEFAULT 'fechado' NOT NULL,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`filamento_id`) REFERENCES `filamento`(`id`) ON UPDATE no action ON DELETE no action
);
