import { sql } from 'drizzle-orm';
import { check, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const agora = sql`(unixepoch() * 1000)`;

// Linha única (id = 1). Preferências globais que afetam cálculo de custo.
export const config = sqliteTable('config', {
	id: integer('id').primaryKey(),
	tarifaKwhCents: integer('tarifa_kwh_cents').notNull().default(95),
	moeda: text('moeda').notNull().default('BRL'),
	// O Bambu Handy em inglês exibe datas em MM/DD/YYYY. Guardamos a
	// preferência porque o parser de screenshot não tem como adivinhar
	// entre 08/09 e 09/08 sem ela.
	formatoDataPrint: text('formato_data_print', { enum: ['MDY', 'DMY'] })
		.notNull()
		.default('MDY'),
	rateioFalhas: integer('rateio_falhas', { mode: 'boolean' }).notNull().default(false),
	// Token da Cloud API da Bambu. Opaco, não é JWT, vale ~1 ano e não tem
	// renovação programática — quando expira, o usuário cola outro.
	tokenNuvem: text('token_nuvem'),
	ultimaImportacaoEm: integer('ultima_importacao_em', { mode: 'timestamp_ms' })
});

export const impressora = sqliteTable('impressora', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	nome: text('nome').notNull(),
	modelo: text('modelo').notNull(),
	// Como a impressora se identifica no print do Handy e na nuvem
	// (ex.: "Unit-01(A1)"). É a chave de amarração automática.
	apelidoBambu: text('apelido_bambu'),
	precoCompraCents: integer('preco_compra_cents').notNull().default(0),
	dataCompra: integer('data_compra', { mode: 'timestamp_ms' }),
	vidaUtilHoras: integer('vida_util_horas').notNull().default(5000),
	potenciaMediaW: integer('potencia_media_w').notNull().default(100),
	ativa: integer('ativa', { mode: 'boolean' }).notNull().default(true),
	criadoEm: integer('criado_em', { mode: 'timestamp_ms' }).notNull().default(agora)
});

/**
 * O ROLO — a única entidade de filamento do sistema.
 *
 * Existia uma tabela `filamento` (o TIPO) e esta (a unidade física). A
 * separação resolvia um problema real — recomprar o mesmo filamento por outro
 * preço não podia sobrescrever o histórico — e criava um pior: duas telas para
 * uma coisa que o dono trata como uma só ("cadê o preço do filamento?").
 *
 * A fusão resolve o mesmo problema por outro caminho, escolhido pelo dono:
 * **cada compra é um registro novo**. Comprar outro rolo igual não soma ao
 * anterior, não atualiza nada — cria uma linha nova, com código próprio. Os
 * campos do tipo (marca, material, cor…) são repetidos de propósito: é
 * exatamente essa repetição que torna os dois rolos independentes.
 *
 * O que nenhuma parte do sistema pode voltar a fazer é reaproveitar linha
 * existente na hora de cadastrar. Ver `docs/relatorio-fusao.md`.
 */
export const rolo = sqliteTable('rolo', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	/**
	 * O nome que vai escrito no carretel com caneta (`PLA-PRETO-03`). Único, e é
	 * a ponte entre o objeto na prateleira e a linha na tela — sem ele, dois
	 * rolos iguais são indistinguíveis na estante. Ver `$lib/codigo`.
	 */
	codigo: text('codigo').notNull().unique(),

	// ── ficha do filamento (era a tabela `filamento`) ─────────────────────────
	marca: text('marca').notNull(),
	material: text('material').notNull(),
	cor: text('cor').notNull(),
	corHex: text('cor_hex'),
	densidade: real('densidade').notNull().default(1.24),
	tempBico: integer('temp_bico'),
	tempMesa: integer('temp_mesa'),
	// Código do catálogo da Bambu (ex.: GFA00 = PLA Basic, GFA18 = PLA Lite,
	// GFG99 = PETG genérico; perfis de parceiro fogem do formato: GFSNL02 é SUNLU).
	// É o mesmo identificador que aparece em `filamentId` no histórico da nuvem,
	// então é por ele que uma importação amarra a tarefa ao rolo certo.
	codigoBambu: text('codigo_bambu'),
	/** Referência exata da variante para mídia. Nula nos registros anteriores/manuais. */
	catalogoItemId: text('catalogo_item_id'),
	// De onde vieram os dados preenchidos: catálogo embarcado ou digitação.
	fonteCatalogo: text('fonte_catalogo', { enum: ['bambu', 'ofd', 'manual'] })
		.notNull()
		.default('manual'),

	// ── a unidade física ──────────────────────────────────────────────────────
	apelido: text('apelido'),
	precoPagoCents: integer('preco_pago_cents').notNull().default(0),
	pesoLiquidoInicialG: real('peso_liquido_inicial_g').notNull().default(1000),
	pesoCarretelG: real('peso_carretel_g').notNull().default(250),
	fornecedor: text('fornecedor'),
	dataCompra: integer('data_compra', { mode: 'timestamp_ms' }),
	dataAbertura: integer('data_abertura', { mode: 'timestamp_ms' }),
	dataUltimaSecagem: integer('data_ultima_secagem', { mode: 'timestamp_ms' }),
	status: text('status', { enum: ['fechado', 'aberto', 'vazio', 'descartado'] })
		.notNull()
		.default('fechado'),
	notas: text('notas'),
	criadoEm: integer('criado_em', { mode: 'timestamp_ms' }).notNull().default(agora)
});

/** Localização escolhida pelo usuário; não altera estado físico nem consumo do rolo. */
export const filamentoAtivo = sqliteTable('filamento_ativo', {
	impressoraId: integer('impressora_id').notNull().references(() => impressora.id, { onDelete: 'cascade' }),
	posicao: integer('posicao').notNull(),
	roloId: integer('rolo_id').notNull().unique().references(() => rolo.id, { onDelete: 'cascade' })
}, (t) => [
	primaryKey({ columns: [t.impressoraId, t.posicao] }),
	check('filamento_ativo_posicao_valida', sql`${t.posicao} in (1, 2, 3, 4)`)
]);

// Pesagem na balança. Vira o novo ponto de partida do cálculo de restante.
export const afericao = sqliteTable('afericao', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	roloId: integer('rolo_id')
		.notNull()
		.references(() => rolo.id),
	pesoLiquidoG: real('peso_liquido_g').notNull(),
	dataEm: integer('data_em', { mode: 'timestamp_ms' }).notNull().default(agora),
	observacao: text('observacao')
});

export const peca = sqliteTable('peca', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	nome: text('nome').notNull(),
	fonteUrl: text('fonte_url'),
	finalidadePadrao: text('finalidade_padrao'),
	notas: text('notas'),
	criadoEm: integer('criado_em', { mode: 'timestamp_ms' }).notNull().default(agora)
});

export const impressao = sqliteTable('impressao', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	pecaId: integer('peca_id').references(() => peca.id),
	nomeLivre: text('nome_livre').notNull(),
	impressoraId: integer('impressora_id')
		.notNull()
		.references(() => impressora.id),
	roloId: integer('rolo_id')
		.notNull()
		.references(() => rolo.id),
	inicioEm: integer('inicio_em', { mode: 'timestamp_ms' }).notNull(),
	fimEm: integer('fim_em', { mode: 'timestamp_ms' }),
	duracaoS: integer('duracao_s').notNull(),
	gramas: real('gramas').notNull(),
	status: text('status', { enum: ['sucesso', 'falha', 'cancelada'] })
		.notNull()
		.default('sucesso'),
	motivoFalha: text('motivo_falha'),
	camadaMm: real('camada_mm'),
	paredes: integer('paredes'),
	infillPct: integer('infill_pct'),
	bicoMm: real('bico_mm'),
	placaBuild: text('placa_build'),
	finalidade: text('finalidade', {
		enum: ['estudio', 'homelab', 'conteudo', 'pessoal', 'outro']
	})
		.notNull()
		.default('outro'),
	imagemPath: text('imagem_path'),
	origem: text('origem', { enum: ['manual', 'ocr', 'nuvem'] })
		.notNull()
		.default('manual'),
	taskIdNuvem: text('task_id_nuvem').unique(),
	/**
	 * Qual plate do arquivo rodou nesta impressão.
	 *
	 * É o campo que torna possível a única distinção que o dono aceita: nome de
	 * modelo repetido significa MESMO ARQUIVO, não mesma peça — a plate pode ter
	 * outro conteúdo em cada tarefa (peças complementares, uma plate mais cheia
	 * que a outra). Com o índice, **a mesma plate impressa duas vezes é
	 * comparável**, e plates diferentes do mesmo projeto continuam sendo
	 * complementares, lado a lado e sem soma.
	 *
	 * **Anulável porque o histórico já gravado não a tem**: as impressões
	 * importadas antes desta rodada nasceram sem o campo, e inventar um valor
	 * para elas seria afirmar parentesco que ninguém declarou. `null` se lê
	 * "plate não identificada" na tela, e é assim que ela aparece.
	 */
	indicePlate: integer('indice_plate'),
	/**
	 * O identificador do projeto na nuvem (`designId`), guardado como texto.
	 *
	 * É a chave real do agrupamento: sobrevive a renomear o modelo e não
	 * confunde dois projetos de nome parecido — ao contrário de `nomeLivre`, que
	 * é texto livre e chega às vezes com espaço no fim.
	 *
	 * Texto, e não número, pelo mesmo motivo de `taskIdNuvem`: id de API não
	 * entra em aritmética. `null` quando o arquivo é do próprio usuário (a nuvem
	 * manda `0`, que é a AUSÊNCIA de projeto) ou quando a linha é anterior a
	 * esta rodada.
	 */
	projetoIdNuvem: text('projeto_id_nuvem'),
	observacoes: text('observacoes'),
	// Custo CONGELADO no momento do registro. Mudar a tarifa de energia hoje
	// não pode reescrever o custo de uma peça impressa em março.
	custoFilamentoCents: integer('custo_filamento_cents').notNull().default(0),
	custoEnergiaCents: integer('custo_energia_cents').notNull().default(0),
	custoDepreciacaoCents: integer('custo_depreciacao_cents').notNull().default(0),
	custoManutencaoCents: integer('custo_manutencao_cents').notNull().default(0),
	custoTotalCents: integer('custo_total_cents').notNull().default(0),
	criadoEm: integer('criado_em', { mode: 'timestamp_ms' }).notNull().default(agora)
});

export const manutencao = sqliteTable('manutencao', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	impressoraId: integer('impressora_id')
		.notNull()
		.references(() => impressora.id),
	tipo: text('tipo', {
		enum: ['bico', 'placa', 'correia', 'lubrificacao', 'outro']
	}).notNull(),
	descricao: text('descricao'),
	custoCents: integer('custo_cents').notNull().default(0),
	horimetroHoras: real('horimetro_horas').notNull().default(0),
	dataEm: integer('data_em', { mode: 'timestamp_ms' }).notNull().default(agora)
});
