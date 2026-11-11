--
-- Fusão de `filamento` dentro de `rolo`.
--
-- Decisão do dono: só existe o rolo. Comprar outro rolo igual não soma ao
-- anterior — é um registro novo, com código único novo. Os campos do tipo
-- (marca, material, cor, corHex, densidade, temperaturas, codigoBambu,
-- fonteCatalogo, notas) passam a viver no próprio rolo, e `filamento` some.
--
-- Como esta migração não perde dado:
--
--  1. `defer_foreign_keys`, e a tabela `rolo` RECRIADA COM O MESMO NOME.
--     O migrador do Drizzle roda tudo dentro de BEGIN/COMMIT, e PRAGMA
--     foreign_keys é ignorado dentro de transação — o DROP TABLE `rolo`
--     bateria em "FOREIGN KEY constraint failed" por causa de `impressao` e
--     `afericao`. `defer_foreign_keys` adia a checagem para o COMMIT.
--
--     Mas adiar não basta: o SQLite conta violações pendentes, e só desconta
--     quando a linha-pai reaparece NA TABELA DA CHAVE. Copiar para
--     `__fusao_rolo` e renomear no fim deixa a conta em aberto e o COMMIT
--     falha. Por isso o desenho é: encher a tabela de passagem, largar
--     `rolo`, criar `rolo` de novo com o nome e os MESMOS ids, e só então
--     inserir. Aí cada insert desconta a pendência das impressões — o próprio
--     banco confere, no COMMIT, que nenhuma impressão ficou órfã.
--  2. `LEFT JOIN`, não `INNER JOIN`. Um rolo apontando para filamento
--     inexistente (só possível com FK desligada) sairia da tabela em silêncio
--     num INNER JOIN. Aqui ele entra com a ficha marcada como desconhecida e
--     uma nota explicando.
--  3. Filamento sem rolo nenhum vira um rolo `vazio`, com nota. Descartar
--     seria apagar cadastro que alguém digitou.
--  4. Nada aqui toca `impressao`. Os custos congelados
--     (custo_filamento_cents e os outros quatro) não são lidos nem escritos —
--     nenhum recálculo por efeito colateral.
--
-- O código legível (PLA-PRETO-01) é gerado ainda na tabela de passagem, com a
-- MESMA regra de `src/lib/codigo.ts`: primeira palavra do material (6), da
-- cor (8), e um contador por prefixo, na ordem dos ids.
-- `src/lib/server/migracao-fusao.test.ts` confere campo a campo, e confere que
-- as duas implementações do código concordam.
--
PRAGMA defer_foreign_keys = ON;--> statement-breakpoint
CREATE TABLE `__fusao_rolo` (
	`id` integer PRIMARY KEY NOT NULL,
	`codigo` text NOT NULL,
	`marca` text NOT NULL,
	`material` text NOT NULL,
	`cor` text NOT NULL,
	`cor_hex` text,
	`densidade` real DEFAULT 1.24 NOT NULL,
	`temp_bico` integer,
	`temp_mesa` integer,
	`codigo_bambu` text,
	`fonte_catalogo` text DEFAULT 'manual' NOT NULL,
	`apelido` text,
	`preco_pago_cents` integer DEFAULT 0 NOT NULL,
	`peso_liquido_inicial_g` real DEFAULT 1000 NOT NULL,
	`peso_carretel_g` real DEFAULT 250 NOT NULL,
	`fornecedor` text,
	`data_compra` integer,
	`data_abertura` integer,
	`data_ultima_secagem` integer,
	`status` text DEFAULT 'fechado' NOT NULL,
	`notas` text,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
INSERT INTO `__fusao_rolo` (`id`, `codigo`, `marca`, `material`, `cor`, `cor_hex`, `densidade`, `temp_bico`, `temp_mesa`, `codigo_bambu`, `fonte_catalogo`, `apelido`, `preco_pago_cents`, `peso_liquido_inicial_g`, `peso_carretel_g`, `fornecedor`, `data_compra`, `data_abertura`, `data_ultima_secagem`, `status`, `notas`, `criado_em`)
SELECT
	r.`id`,
	'#' || r.`id`,
	COALESCE(f.`marca`, 'desconhecida'),
	COALESCE(f.`material`, 'desconhecido'),
	COALESCE(f.`cor`, 'desconhecida'),
	f.`cor_hex`,
	COALESCE(f.`densidade`, 1.24),
	f.`temp_bico`,
	f.`temp_mesa`,
	f.`codigo_bambu`,
	COALESCE(f.`fonte_catalogo`, 'manual'),
	r.`apelido`,
	r.`preco_pago_cents`,
	r.`peso_liquido_inicial_g`,
	r.`peso_carretel_g`,
	r.`fornecedor`,
	r.`data_compra`,
	r.`data_abertura`,
	r.`data_ultima_secagem`,
	r.`status`,
	CASE
		WHEN f.`id` IS NULL THEN trim(COALESCE(f.`notas` || char(10) || char(10), '') || 'A ficha do filamento nao foi encontrada na fusao (filamento_id sem correspondente). Marca, material e cor entraram como desconhecidos: corrija no cadastro.')
		ELSE f.`notas`
	END,
	r.`criado_em`
FROM `rolo` r LEFT JOIN `filamento` f ON f.`id` = r.`filamento_id`;--> statement-breakpoint
INSERT INTO `__fusao_rolo` (`id`, `codigo`, `marca`, `material`, `cor`, `cor_hex`, `densidade`, `temp_bico`, `temp_mesa`, `codigo_bambu`, `fonte_catalogo`, `apelido`, `preco_pago_cents`, `peso_liquido_inicial_g`, `peso_carretel_g`, `fornecedor`, `data_compra`, `data_abertura`, `data_ultima_secagem`, `status`, `notas`, `criado_em`)
SELECT
	(SELECT COALESCE(MAX(`id`), 0) FROM `rolo`) + ROW_NUMBER() OVER (ORDER BY f.`id`),
	'#orfao' || f.`id`,
	f.`marca`,
	f.`material`,
	f.`cor`,
	f.`cor_hex`,
	f.`densidade`,
	f.`temp_bico`,
	f.`temp_mesa`,
	f.`codigo_bambu`,
	f.`fonte_catalogo`,
	NULL,
	0,
	1000,
	250,
	NULL,
	NULL,
	NULL,
	NULL,
	'vazio',
	trim(COALESCE(f.`notas` || char(10) || char(10), '') || 'Este registro era um TIPO de filamento sem nenhum rolo. A fusão o preservou como rolo vazio para nao perder o cadastro; apague se nao servir.'),
	f.`criado_em`
FROM `filamento` f
WHERE NOT EXISTS (SELECT 1 FROM `rolo` r WHERE r.`filamento_id` = f.`id`);--> statement-breakpoint
UPDATE `__fusao_rolo` AS alvo
SET `codigo` = pronto.`codigo`
FROM (
	SELECT
		`id`,
		`mat` || '-' || `cor` || '-' ||
			CASE WHEN `seq` < 100 THEN printf('%02d', `seq`) ELSE printf('%d', `seq`) END AS `codigo`
	FROM (
		SELECT `id`, `mat`, `cor`,
			ROW_NUMBER() OVER (PARTITION BY `mat`, `cor` ORDER BY `id`) AS `seq`
		FROM (
			SELECT `id`,
				CASE WHEN `mat_cru` = '' THEN 'ROLO' ELSE `mat_cru` END AS `mat`,
				CASE WHEN `cor_crua` = '' THEN 'COR' ELSE `cor_crua` END AS `cor`
			FROM (
				SELECT `id`,
					substr(CASE WHEN instr(`mat_txt`, ' ') > 0 THEN substr(`mat_txt`, 1, instr(`mat_txt`, ' ') - 1) ELSE `mat_txt` END, 1, 6) AS `mat_cru`,
					substr(CASE WHEN instr(`cor_txt`, ' ') > 0 THEN substr(`cor_txt`, 1, instr(`cor_txt`, ' ') - 1) ELSE `cor_txt` END, 1, 8) AS `cor_crua`
				FROM (
					SELECT `id`,
						trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(upper(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(`material`, 'á', 'a'), 'à', 'a'), 'â', 'a'), 'ã', 'a'), 'ä', 'a'), 'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e'), 'í', 'i'), 'ì', 'i'), 'î', 'i'), 'ï', 'i'), 'ó', 'o'), 'ò', 'o'), 'ô', 'o'), 'õ', 'o'), 'ö', 'o'), 'ú', 'u'), 'ù', 'u'), 'û', 'u'), 'ü', 'u'), 'ç', 'c'), 'ñ', 'n'), 'ý', 'y'), 'Á', 'A'), 'À', 'A'), 'Â', 'A'), 'Ã', 'A'), 'Ä', 'A'), 'É', 'E'), 'È', 'E'), 'Ê', 'E'), 'Ë', 'E'), 'Í', 'I'), 'Ì', 'I'), 'Î', 'I'), 'Ï', 'I'), 'Ó', 'O'), 'Ò', 'O'), 'Ô', 'O'), 'Õ', 'O'), 'Ö', 'O'), 'Ú', 'U'), 'Ù', 'U'), 'Û', 'U'), 'Ü', 'U'), 'Ç', 'C'), 'Ñ', 'N'), 'Ý', 'Y')), '-', ' '), '_', ' '), '/', ' '), '\', ' '), '.', ' '), '+', ' '), '(', ' '), ')', ' '), ',', ' '), '&', ' '), '#', ' '), ':', ' '), ';', ' '), '|', ' '), '*', ' ')) AS `mat_txt`,
						trim(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(upper(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(`cor`, 'á', 'a'), 'à', 'a'), 'â', 'a'), 'ã', 'a'), 'ä', 'a'), 'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e'), 'í', 'i'), 'ì', 'i'), 'î', 'i'), 'ï', 'i'), 'ó', 'o'), 'ò', 'o'), 'ô', 'o'), 'õ', 'o'), 'ö', 'o'), 'ú', 'u'), 'ù', 'u'), 'û', 'u'), 'ü', 'u'), 'ç', 'c'), 'ñ', 'n'), 'ý', 'y'), 'Á', 'A'), 'À', 'A'), 'Â', 'A'), 'Ã', 'A'), 'Ä', 'A'), 'É', 'E'), 'È', 'E'), 'Ê', 'E'), 'Ë', 'E'), 'Í', 'I'), 'Ì', 'I'), 'Î', 'I'), 'Ï', 'I'), 'Ó', 'O'), 'Ò', 'O'), 'Ô', 'O'), 'Õ', 'O'), 'Ö', 'O'), 'Ú', 'U'), 'Ù', 'U'), 'Û', 'U'), 'Ü', 'U'), 'Ç', 'C'), 'Ñ', 'N'), 'Ý', 'Y')), '-', ' '), '_', ' '), '/', ' '), '\', ' '), '.', ' '), '+', ' '), '(', ' '), ')', ' '), ',', ' '), '&', ' '), '#', ' '), ':', ' '), ';', ' '), '|', ' '), '*', ' ')) AS `cor_txt`
					FROM `__fusao_rolo`
				)
			)
		)
	)
) AS pronto
WHERE pronto.`id` = alvo.`id`;--> statement-breakpoint
DROP TABLE `rolo`;--> statement-breakpoint
DROP TABLE `filamento`;--> statement-breakpoint
CREATE TABLE `rolo` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`codigo` text NOT NULL,
	`marca` text NOT NULL,
	`material` text NOT NULL,
	`cor` text NOT NULL,
	`cor_hex` text,
	`densidade` real DEFAULT 1.24 NOT NULL,
	`temp_bico` integer,
	`temp_mesa` integer,
	`codigo_bambu` text,
	`fonte_catalogo` text DEFAULT 'manual' NOT NULL,
	`apelido` text,
	`preco_pago_cents` integer DEFAULT 0 NOT NULL,
	`peso_liquido_inicial_g` real DEFAULT 1000 NOT NULL,
	`peso_carretel_g` real DEFAULT 250 NOT NULL,
	`fornecedor` text,
	`data_compra` integer,
	`data_abertura` integer,
	`data_ultima_secagem` integer,
	`status` text DEFAULT 'fechado' NOT NULL,
	`notas` text,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL
);--> statement-breakpoint
INSERT INTO `rolo` (`id`, `codigo`, `marca`, `material`, `cor`, `cor_hex`, `densidade`, `temp_bico`, `temp_mesa`, `codigo_bambu`, `fonte_catalogo`, `apelido`, `preco_pago_cents`, `peso_liquido_inicial_g`, `peso_carretel_g`, `fornecedor`, `data_compra`, `data_abertura`, `data_ultima_secagem`, `status`, `notas`, `criado_em`)
SELECT `id`, `codigo`, `marca`, `material`, `cor`, `cor_hex`, `densidade`, `temp_bico`, `temp_mesa`, `codigo_bambu`, `fonte_catalogo`, `apelido`, `preco_pago_cents`, `peso_liquido_inicial_g`, `peso_carretel_g`, `fornecedor`, `data_compra`, `data_abertura`, `data_ultima_secagem`, `status`, `notas`, `criado_em` FROM `__fusao_rolo` ORDER BY `id`;--> statement-breakpoint
DROP TABLE `__fusao_rolo`;--> statement-breakpoint
CREATE UNIQUE INDEX `rolo_codigo_unique` ON `rolo` (`codigo`);
