/**
 * A migração das duas colunas de plate, conferida contra um banco no formato
 * de HOJE.
 *
 * O banco que está no ar tem 11 impressões com custo congelado que não existe
 * em mais lugar nenhum, e a atribuição de rolo que o dono fez à mão em cada
 * uma. Esta migração é aditiva — duas colunas anuláveis — mas "é aditiva" é uma
 * afirmação sobre o SQL, e o que precisa ser provado é o efeito: **nada mudou**
 * além das duas colunas novas.
 *
 * Como em `migracao-fusao.test.ts`, o cenário é montado em SQL cru sobre o
 * estado ANTERIOR (migrations até a 0002), e não com o schema do Drizzle de
 * hoje — usar o schema de hoje seria testar a migração contra um banco que já
 * está migrado.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const RAIZ = './drizzle';
const ULTIMA_ANTES_DAS_PLATES = 2;

/** Uma cópia da pasta de migrations parando na 0002 — o banco que está no ar. */
function pastaAntesDasPlates(ultima = ULTIMA_ANTES_DAS_PLATES): string {
	const dir = mkdtempSync(join(tmpdir(), 'carretel-antes-plates-'));
	mkdirSync(join(dir, 'meta'));
	const diario = JSON.parse(readFileSync(join(RAIZ, 'meta/_journal.json'), 'utf8'));
	const ate = {
		...diario,
		entries: diario.entries.filter((e: { idx: number }) => e.idx <= ultima)
	};
	writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(ate, null, 2));
	for (const e of ate.entries as { tag: string }[]) {
		cpSync(join(RAIZ, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
	}
	return dir;
}

function bancoDeHoje() {
	const sqlite = new Database(':memory:');
	// Ligada de propósito: é como o app e os testes abrem o banco.
	sqlite.pragma('foreign_keys = ON');
	migrate(drizzle(sqlite), { migrationsFolder: pastaAntesDasPlates() });
	return sqlite;
}

const aplicarPlates = (sqlite: Database.Database) =>
	migrate(drizzle(sqlite), { migrationsFolder: pastaAntesDasPlates(3) });

type Linha = Record<string, unknown>;
let sqlite: Database.Database;

const todos = (sql: string): Linha[] => sqlite.prepare(sql).all() as Linha[];
const um = (sql: string): Linha => sqlite.prepare(sql).get() as Linha;
const colunas = (tabela: string) => todos(`PRAGMA table_info(${tabela})`);
const nomesDeColuna = (tabela: string) => colunas(tabela).map((c) => c.name as string);

const TABELAS = ['config', 'impressora', 'rolo', 'afericao', 'peca', 'impressao', 'manutencao'];

/** Todo o conteúdo do banco, tabela a tabela, em ordem estável. */
function retrato(): Record<string, Linha[]> {
	const r: Record<string, Linha[]> = {};
	for (const t of TABELAS) r[t] = todos(`SELECT * FROM ${t} ORDER BY id`);
	return r;
}

/**
 * O cenário de produção: uma A1, dois rolos, e impressões com os cinco custos
 * congelados, finalidade escolhida à mão, peso e duração já ajustados.
 */
function comoEmProducao() {
	sqlite.exec(`
		INSERT INTO config (id, tarifa_kwh_cents, moeda, formato_data_print, rateio_falhas,
		                    token_nuvem, ultima_importacao_em)
		VALUES (1, 95, 'BRL', 'MDY', 0, 'tok-opaco', 1786342775620);

		INSERT INTO impressora (id, nome, modelo, apelido_bambu, preco_compra_cents, data_compra,
		                        vida_util_horas, potencia_media_w, ativa, criado_em)
		VALUES (1,'A1','Bambu Lab A1','Unit-01(A1)',400000,1780000000000,8000,150,1,900);

		INSERT INTO rolo (id, codigo, marca, material, cor, cor_hex, densidade, temp_bico, temp_mesa,
		                  codigo_bambu, fonte_catalogo, apelido, preco_pago_cents,
		                  peso_liquido_inicial_g, peso_carretel_g, fornecedor, data_compra,
		                  data_abertura, data_ultima_secagem, status, notas, criado_em)
		VALUES (1,'PLA-PRETO-01','Bambu Lab','PLA Basic','Preto','#000000',1.26,220,55,'GFA00','bambu',
		        'o do estúdio',12000,1000,250,'Loja X',2001,2002,2003,'aberto','ficha do preto',2004),
		       (2,'PETG-VERDE-01','Voolt 3D','PETG HF','Verde-limão',NULL,1.27,255,70,'GFG99','manual',
		        NULL,9900,1000,250,NULL,NULL,NULL,NULL,'fechado',NULL,2005);

		INSERT INTO afericao (id, rolo_id, peso_liquido_g, data_em, observacao)
		VALUES (1,1,600,5001,'pesagem manual');

		INSERT INTO peca (id, nome, fonte_url, finalidade_padrao, notas, criado_em)
		VALUES (1,'MagicTray',NULL,'estudio',NULL,6001);

		INSERT INTO impressao (id, peca_id, nome_livre, impressora_id, rolo_id, inicio_em, fim_em,
		                       duracao_s, gramas, status, motivo_falha, camada_mm, paredes, infill_pct,
		                       bico_mm, placa_build, finalidade, imagem_path, origem, task_id_nuvem,
		                       observacoes, custo_filamento_cents, custo_energia_cents,
		                       custo_depreciacao_cents, custo_manutencao_cents, custo_total_cents,
		                       criado_em)
		VALUES (1,1,'MagicTray',1,1,1786296388000,1786300000000,3612,47.72,'sucesso',NULL,0.2,2,15,
		        0.4,'textured_plate','estudio','nuvem/1153976538.png','nuvem','t-1','nota do dono',
		        572,14,50,7,643,3003),
		       (2,NULL,'MagicTray',1,1,1786291486000,1786295000000,3514,54.29,'sucesso',NULL,0.2,2,15,
		        0.4,'textured_plate','estudio',NULL,'nuvem','t-2',NULL,651,13,49,7,720,4003),
		       (3,NULL,'Base do ventilador',1,2,1786200000000,1786200720000,720,4.2,'falha',
		        'entupiu',0.2,2,15,0.4,'textured_plate','homelab',NULL,'nuvem','t-3',NULL,
		        41,2,10,1,54,4004),
		       (4,NULL,'Caixa digitada à mão',1,1,1786100000000,NULL,1800,12.5,'sucesso',NULL,
		        NULL,NULL,NULL,NULL,NULL,'pessoal',NULL,'manual',NULL,NULL,150,7,25,3,185,4005);

		INSERT INTO manutencao (id, impressora_id, tipo, descricao, custo_cents, horimetro_horas, data_em)
		VALUES (1,1,'bico','troca de bico',8000,19.67,7001);
	`);
}

beforeEach(() => {
	sqlite = bancoDeHoje();
	comoEmProducao();
});

describe('plates: a migração acrescenta as duas colunas', () => {
	it('cria indice_plate e projeto_id_nuvem em impressao', () => {
		expect(nomesDeColuna('impressao')).not.toContain('indice_plate');
		aplicarPlates(sqlite);
		expect(nomesDeColuna('impressao')).toContain('indice_plate');
		expect(nomesDeColuna('impressao')).toContain('projeto_id_nuvem');
	});

	it('as duas são ANULÁVEIS e sem padrão — histórico gravado não as tem', () => {
		aplicarPlates(sqlite);
		for (const nome of ['indice_plate', 'projeto_id_nuvem']) {
			const c = colunas('impressao').find((x) => x.name === nome)!;
			expect(c.notnull).toBe(0);
			expect(c.dflt_value).toBeNull();
		}
	});

	it('toda linha já gravada chega com as duas em NULL', () => {
		aplicarPlates(sqlite);
		expect(todos('SELECT id, indice_plate, projeto_id_nuvem FROM impressao ORDER BY id')).toEqual([
			{ id: 1, indice_plate: null, projeto_id_nuvem: null },
			{ id: 2, indice_plate: null, projeto_id_nuvem: null },
			{ id: 3, indice_plate: null, projeto_id_nuvem: null },
			{ id: 4, indice_plate: null, projeto_id_nuvem: null }
		]);
	});
});

describe('plates: nada mais mudou', () => {
	it('a SOMA dos custos congelados é idêntica, centavo a centavo', () => {
		const antes = um(`SELECT SUM(custo_filamento_cents) f, SUM(custo_energia_cents) e,
		                         SUM(custo_depreciacao_cents) d, SUM(custo_manutencao_cents) m,
		                         SUM(custo_total_cents) t FROM impressao`);
		aplicarPlates(sqlite);
		const depois = um(`SELECT SUM(custo_filamento_cents) f, SUM(custo_energia_cents) e,
		                          SUM(custo_depreciacao_cents) d, SUM(custo_manutencao_cents) m,
		                          SUM(custo_total_cents) t FROM impressao`);
		expect(depois).toEqual(antes);
		expect(depois.t).toBe(643 + 720 + 54 + 185);
	});

	it('cada linha de impressao sai igual, campo a campo, tirando as duas novas', () => {
		const antes = todos('SELECT * FROM impressao ORDER BY id');
		aplicarPlates(sqlite);
		const depois = todos('SELECT * FROM impressao ORDER BY id').map((l) => {
			const { indice_plate, projeto_id_nuvem, ...resto } = l;
			void indice_plate;
			void projeto_id_nuvem;
			return resto;
		});
		expect(depois).toEqual(antes);
	});

	it('as outras seis tabelas saem byte a byte iguais', () => {
		const antes = retrato();
		aplicarPlates(sqlite);
		const depois = retrato();
		for (const t of TABELAS.filter((t) => t !== 'impressao')) {
			expect(depois[t], `tabela ${t}`).toEqual(antes[t]);
		}
	});

	it('nenhuma tabela foi recriada, largada ou criada', () => {
		const antes = todos("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
			.map((t) => t.name)
			.filter((n) => n !== '__drizzle_migrations');
		aplicarPlates(sqlite);
		const depois = todos("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
			.map((t) => t.name)
			.filter((n) => n !== '__drizzle_migrations');
		expect(depois).toEqual(antes);
	});

	// A fusão (0002) recriou `rolo` e teve que adiar checagem de chave
	// estrangeira para isso. Esta não recria nada — e o banco confere sozinho.
	it('nenhuma chave estrangeira fica pendurada', () => {
		aplicarPlates(sqlite);
		expect(todos('PRAGMA foreign_key_check')).toEqual([]);
	});

	it('as impressões continuam apontando para os MESMOS rolo e impressora', () => {
		aplicarPlates(sqlite);
		expect(todos('SELECT id, rolo_id, impressora_id FROM impressao ORDER BY id')).toEqual([
			{ id: 1, rolo_id: 1, impressora_id: 1 },
			{ id: 2, rolo_id: 1, impressora_id: 1 },
			{ id: 3, rolo_id: 2, impressora_id: 1 },
			{ id: 4, rolo_id: 1, impressora_id: 1 }
		]);
	});

	it('rodar a migração de novo não faz nada — o entrypoint sobe a cada boot', () => {
		aplicarPlates(sqlite);
		const antes = retrato();
		aplicarPlates(sqlite);
		expect(retrato()).toEqual(antes);
	});
});

describe('plates: banco vazio também migra', () => {
	// O primeiro `docker compose up` de uma máquina nova roda as três migrations
	// em sequência, sem nenhuma linha. Uma migração que só funcione com dado
	// dentro é uma que quebra a instalação limpa.
	it('sobe do zero até a última sem nenhuma linha', () => {
		const limpo = new Database(':memory:');
		limpo.pragma('foreign_keys = ON');
		expect(() => migrate(drizzle(limpo), { migrationsFolder: RAIZ })).not.toThrow();
		const cols = (limpo.prepare('PRAGMA table_info(impressao)').all() as Linha[]).map(
			(c) => c.name
		);
		expect(cols).toContain('indice_plate');
		expect(cols).toContain('projeto_id_nuvem');
	});
});
