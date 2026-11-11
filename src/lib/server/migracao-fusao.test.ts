/**
 * A migração da fusão, conferida campo a campo.
 *
 * O banco de produção tem 11 impressões, 1 impressora e 2 rolos com histórico
 * de custo que não existe em mais lugar nenhum. Uma migração que "roda sem
 * erro" não é garantia de nada aqui — o que precisa ser provado é que cada
 * campo chegou no rolo certo, que as impressões continuam apontando para os
 * mesmos rolos, e que **nenhum custo congelado foi tocado**.
 *
 * Por isso o teste não usa o schema do Drizzle para montar o cenário: ele
 * escreve SQL no formato ANTIGO (com a tabela `filamento` e `rolo.filamento_id`)
 * migrando primeiro só até a 0001, exatamente como o banco que está no ar. Se
 * ele usasse o schema de hoje, estaria testando a migração contra um banco que
 * já está migrado.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { proximoCodigo } from '$lib/codigo';

const RAIZ = './drizzle';
const ULTIMA_ANTES_DA_FUSAO = 1;

/**
 * Uma cópia da pasta de migrations parando na 0001 — o estado em que o banco
 * de produção está antes desta entrega.
 */
function pastaAntesDaFusao(): string {
	const dir = mkdtempSync(join(tmpdir(), 'carretel-antes-fusao-'));
	mkdirSync(join(dir, 'meta'));
	const diario = JSON.parse(readFileSync(join(RAIZ, 'meta/_journal.json'), 'utf8'));
	const ate = {
		...diario,
		entries: diario.entries.filter((e: { idx: number }) => e.idx <= ULTIMA_ANTES_DA_FUSAO)
	};
	writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(ate, null, 2));
	for (const e of ate.entries as { tag: string }[]) {
		cpSync(join(RAIZ, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
	}
	return dir;
}

function bancoAntigo() {
	const sqlite = new Database(':memory:');
	// Ligada de propósito: é como os testes e o app abrem o banco, e é a
	// configuração em que a versão ingênua desta migração quebrava no COMMIT.
	sqlite.pragma('foreign_keys = ON');
	migrate(drizzle(sqlite), { migrationsFolder: pastaAntesDaFusao() });
	return sqlite;
}

const fundir = (sqlite: Database.Database) =>
	migrate(drizzle(sqlite), { migrationsFolder: RAIZ });

let sqlite: Database.Database;
beforeEach(() => {
	sqlite = bancoAntigo();
});

type Linha = Record<string, unknown>;
const todos = (sql: string): Linha[] => sqlite.prepare(sql).all() as Linha[];
const um = (sql: string): Linha => sqlite.prepare(sql).get() as Linha;

/** O cenário de produção: 2 filamentos, 2 rolos 1-para-1, impressões e pesagem. */
function comoEmProducao() {
	sqlite.exec(`
		INSERT INTO filamento (id, marca, material, cor, cor_hex, densidade, temp_bico, temp_mesa,
		                       codigo_bambu, fonte_catalogo, notas, criado_em)
		VALUES (1,'Bambu Lab','PLA Basic','Preto','#000000',1.26,220,55,'GFA00','bambu','ficha do preto',1001),
		       (2,'Voolt 3D','PETG HF','Verde-limão',NULL,1.27,255,70,'GFG99','manual',NULL,1002);

		INSERT INTO impressora (id, nome, modelo, apelido_bambu, preco_compra_cents, vida_util_horas,
		                        potencia_media_w, ativa, criado_em)
		VALUES (1,'A1','Bambu Lab A1','Unit-01(A1)',400000,8000,150,1,900);

		INSERT INTO rolo (id, filamento_id, apelido, preco_pago_cents, peso_liquido_inicial_g,
		                  peso_carretel_g, fornecedor, data_compra, data_abertura, data_ultima_secagem,
		                  status, criado_em)
		VALUES (1,1,'o do estúdio',12000,750,180,'Loja X',2001,2002,2003,'aberto',2004),
		       (2,2,NULL,9900,1000,250,NULL,NULL,NULL,NULL,'fechado',2005);

		INSERT INTO impressao (id, nome_livre, impressora_id, rolo_id, inicio_em, fim_em, duracao_s,
		                       gramas, status, finalidade, origem, task_id_nuvem,
		                       custo_filamento_cents, custo_energia_cents, custo_depreciacao_cents,
		                       custo_manutencao_cents, custo_total_cents, criado_em)
		VALUES (1,'caixa',1,1,3001,3002,3600,100,'sucesso','estudio','nuvem','t-1',1600,14,50,7,1671,3003),
		       (2,'tampa',1,2,4001,4002,7200,55,'falha','pessoal','nuvem','t-2',545,29,100,13,687,4003);

		INSERT INTO afericao (id, rolo_id, peso_liquido_g, data_em, observacao)
		VALUES (1,1,600,5001,'pesagem manual');
	`);
}

describe('fusão: os campos do filamento chegam no rolo', () => {
	beforeEach(() => {
		comoEmProducao();
		fundir(sqlite);
	});

	it('copia a ficha inteira do filamento para o rolo, campo a campo', () => {
		const r = um('SELECT * FROM rolo WHERE id = 1');
		expect(r.marca).toBe('Bambu Lab');
		expect(r.material).toBe('PLA Basic');
		expect(r.cor).toBe('Preto');
		expect(r.cor_hex).toBe('#000000');
		expect(r.densidade).toBeCloseTo(1.26);
		expect(r.temp_bico).toBe(220);
		expect(r.temp_mesa).toBe(55);
		expect(r.codigo_bambu).toBe('GFA00');
		expect(r.fonte_catalogo).toBe('bambu');
		expect(r.notas).toBe('ficha do preto');
	});

	it('preserva os campos que já eram do rolo', () => {
		const r = um('SELECT * FROM rolo WHERE id = 1');
		expect(r.apelido).toBe('o do estúdio');
		expect(r.preco_pago_cents).toBe(12000);
		expect(r.peso_liquido_inicial_g).toBe(750);
		expect(r.peso_carretel_g).toBe(180);
		expect(r.fornecedor).toBe('Loja X');
		expect(r.data_compra).toBe(2001);
		expect(r.data_abertura).toBe(2002);
		expect(r.data_ultima_secagem).toBe(2003);
		expect(r.status).toBe('aberto');
		expect(r.criado_em).toBe(2004);
	});

	it('não troca as fichas entre rolos', () => {
		const r2 = um('SELECT * FROM rolo WHERE id = 2');
		expect(r2.marca).toBe('Voolt 3D');
		expect(r2.material).toBe('PETG HF');
		expect(r2.cor).toBe('Verde-limão');
		expect(r2.cor_hex).toBe(null);
		expect(r2.codigo_bambu).toBe('GFG99');
		expect(r2.fonte_catalogo).toBe('manual');
		expect(r2.preco_pago_cents).toBe(9900);
	});

	it('a tabela filamento deixa de existir', () => {
		const tabelas = todos("SELECT name FROM sqlite_master WHERE type = 'table'").map(
			(t) => t.name
		);
		expect(tabelas).not.toContain('filamento');
		expect(tabelas).toContain('rolo');
	});

	it('o rolo não guarda mais filamento_id', () => {
		const colunas = todos('PRAGMA table_info(rolo)').map((c) => c.name);
		expect(colunas).not.toContain('filamento_id');
	});
});

describe('fusão: o histórico de impressão sai intacto', () => {
	beforeEach(() => {
		comoEmProducao();
		fundir(sqlite);
	});

	it('cada impressão continua apontando para o MESMO rolo', () => {
		expect(todos('SELECT id, rolo_id FROM impressao ORDER BY id')).toEqual([
			{ id: 1, rolo_id: 1 },
			{ id: 2, rolo_id: 2 }
		]);
	});

	it('os cinco custos congelados saem byte a byte iguais', () => {
		expect(
			todos(`SELECT id, custo_filamento_cents, custo_energia_cents, custo_depreciacao_cents,
			              custo_manutencao_cents, custo_total_cents FROM impressao ORDER BY id`)
		).toEqual([
			{
				id: 1,
				custo_filamento_cents: 1600,
				custo_energia_cents: 14,
				custo_depreciacao_cents: 50,
				custo_manutencao_cents: 7,
				custo_total_cents: 1671
			},
			{
				id: 2,
				custo_filamento_cents: 545,
				custo_energia_cents: 29,
				custo_depreciacao_cents: 100,
				custo_manutencao_cents: 13,
				custo_total_cents: 687
			}
		]);
	});

	it('nenhum custo bate com o que um recálculo produziria — prova de que ninguém recalculou', () => {
		// Os números do cenário foram escolhidos ERRADOS de propósito: 100 g num
		// rolo de 12000/750 dariam 1600 (bate), mas a segunda impressão dariam
		// 55 g × (9900/1000) = 545 — e a manutenção seria 0, porque não há
		// manutenção cadastrada. Os 7 e os 13 gravados só sobrevivem se a
		// migração não encostar na tabela.
		const custos = todos('SELECT custo_manutencao_cents AS c FROM impressao ORDER BY id');
		expect(custos.map((l) => l.c)).toEqual([7, 13]);
	});

	it('nenhum outro campo da impressão se mexe', () => {
		const i = um('SELECT * FROM impressao WHERE id = 1');
		expect(i.nome_livre).toBe('caixa');
		expect(i.impressora_id).toBe(1);
		expect(i.inicio_em).toBe(3001);
		expect(i.fim_em).toBe(3002);
		expect(i.duracao_s).toBe(3600);
		expect(i.gramas).toBe(100);
		expect(i.status).toBe('sucesso');
		expect(i.finalidade).toBe('estudio');
		expect(i.origem).toBe('nuvem');
		expect(i.task_id_nuvem).toBe('t-1');
		expect(i.criado_em).toBe(3003);
	});

	it('as pesagens continuam ancoradas no rolo delas', () => {
		expect(todos('SELECT id, rolo_id, peso_liquido_g, data_em FROM afericao')).toEqual([
			{ id: 1, rolo_id: 1, peso_liquido_g: 600, data_em: 5001 }
		]);
	});

	it('o banco confere as chaves estrangeiras sozinho depois da migração', () => {
		expect(sqlite.pragma('foreign_key_check')).toEqual([]);
	});
});

describe('fusão: o código legível', () => {
	it('numera por prefixo, na ordem dos ids', () => {
		comoEmProducao();
		fundir(sqlite);
		expect(todos('SELECT id, codigo FROM rolo ORDER BY id')).toEqual([
			{ id: 1, codigo: 'PLA-PRETO-01' },
			{ id: 2, codigo: 'PETG-VERDE-01' }
		]);
	});

	it('dois rolos do MESMO filamento recebem números diferentes', () => {
		sqlite.exec(`
			INSERT INTO filamento (id, marca, material, cor, densidade) VALUES (1,'Bambu','PLA Basic','Preto',1.26);
			INSERT INTO rolo (id, filamento_id, preco_pago_cents) VALUES (1,1,12000),(2,1,13500),(3,1,9900);
		`);
		fundir(sqlite);
		expect(todos('SELECT codigo FROM rolo ORDER BY id').map((r) => r.codigo)).toEqual([
			'PLA-PRETO-01',
			'PLA-PRETO-02',
			'PLA-PRETO-03'
		]);
	});

	it('dobra acento e corta na primeira palavra, como o gerador do TypeScript', () => {
		sqlite.exec(`
			INSERT INTO filamento (id, marca, material, cor, densidade) VALUES
				(1,'X','PETG HF','Verde-limão',1.27),
				(2,'X','PLA Silk+','Abóbora',1.32),
				(3,'X','TPU 95A','Cinza-chumbo',1.21),
				(4,'X','ABS','Branco',1.04);
			INSERT INTO rolo (id, filamento_id, preco_pago_cents) VALUES (1,1,0),(2,2,0),(3,3,0),(4,4,0);
		`);
		fundir(sqlite);

		const codigos = todos('SELECT codigo FROM rolo ORDER BY id').map((r) => r.codigo);
		expect(codigos).toEqual(['PETG-VERDE-01', 'PLA-ABOBORA-01', 'TPU-CINZA-01', 'ABS-BRANCO-01']);

		// E a mesma entrada, pelo gerador do app, dá a mesma coisa. As duas
		// implementações são obrigadas a concordar: uma numera o banco que já
		// existe, a outra numera todo cadastro novo daqui pra frente.
		const tipos = [
			{ material: 'PETG HF', cor: 'Verde-limão' },
			{ material: 'PLA Silk+', cor: 'Abóbora' },
			{ material: 'TPU 95A', cor: 'Cinza-chumbo' },
			{ material: 'ABS', cor: 'Branco' }
		];
		expect(tipos.map((t) => proximoCodigo(t, []))).toEqual(codigos);
	});

	it('trunca material em 6 e cor em 8', () => {
		sqlite.exec(`
			INSERT INTO filamento (id, marca, material, cor, densidade)
			VALUES (1,'X','POLICARBONATO','TURQUESADO',1.2);
			INSERT INTO rolo (id, filamento_id, preco_pago_cents) VALUES (1,1,0);
		`);
		fundir(sqlite);
		expect(um('SELECT codigo FROM rolo').codigo).toBe('POLICA-TURQUESA-01');
	});

	it('o código é único no banco — o índice recusa o repetido', () => {
		comoEmProducao();
		fundir(sqlite);
		expect(() =>
			sqlite.exec(
				`INSERT INTO rolo (codigo, marca, material, cor) VALUES ('PLA-PRETO-01','x','y','z')`
			)
		).toThrow(/UNIQUE/);
	});
});

describe('fusão: filamento sem rolo nenhum', () => {
	beforeEach(() => {
		sqlite.exec(`
			INSERT INTO filamento (id, marca, material, cor, cor_hex, densidade, temp_bico, temp_mesa,
			                       codigo_bambu, fonte_catalogo, notas, criado_em)
			VALUES (1,'Sunlu','PLA Matte','Cinza','#888888',1.32,215,60,'GFSNL02','bambu','comprei em 2024',7001);
		`);
		fundir(sqlite);
	});

	/**
	 * A alternativa era descartar. Não dá: é cadastro que alguém digitou, e uma
	 * migração que apaga cadastro em silêncio é exatamente o que esta entrega
	 * não pode fazer. Ele vira um rolo `vazio` — o único status que o mantém
	 * fora da sugestão de importação e fora dos alertas de estoque, e ainda
	 * assim visível e apagável na tela.
	 */
	it('vira um rolo vazio, com a ficha inteira preservada', () => {
		const r = um('SELECT * FROM rolo');
		expect(r.status).toBe('vazio');
		expect(r.marca).toBe('Sunlu');
		expect(r.material).toBe('PLA Matte');
		expect(r.cor).toBe('Cinza');
		expect(r.cor_hex).toBe('#888888');
		expect(r.densidade).toBeCloseTo(1.32);
		expect(r.temp_bico).toBe(215);
		expect(r.temp_mesa).toBe(60);
		expect(r.codigo_bambu).toBe('GFSNL02');
		expect(r.criado_em).toBe(7001);
	});

	it('entra com preço zero — ninguém pagou por um rolo que não existe', () => {
		expect(um('SELECT preco_pago_cents FROM rolo').preco_pago_cents).toBe(0);
	});

	it('explica na nota o que aconteceu, sem apagar a nota que já havia', () => {
		const notas = String(um('SELECT notas FROM rolo').notas);
		expect(notas).toContain('comprei em 2024');
		expect(notas).toContain('TIPO de filamento sem nenhum rolo');
	});

	it('ganha código como qualquer outro', () => {
		expect(um('SELECT codigo FROM rolo').codigo).toBe('PLA-CINZA-01');
	});
});

describe('fusão: casos de banco torto', () => {
	it('rolo apontando para filamento que não existe não é descartado', () => {
		// Só possível com FK desligada — mas um INNER JOIN aqui sumiria com o
		// rolo E com as impressões dele, que é a pior perda possível.
		sqlite.pragma('foreign_keys = OFF');
		sqlite.exec(`
			INSERT INTO rolo (id, filamento_id, preco_pago_cents, peso_liquido_inicial_g)
			VALUES (1, 404, 15000, 800);
		`);
		fundir(sqlite);

		const r = um('SELECT * FROM rolo WHERE id = 1');
		expect(r.preco_pago_cents).toBe(15000);
		expect(r.peso_liquido_inicial_g).toBe(800);
		expect(r.marca).toBe('desconhecida');
		expect(r.material).toBe('desconhecido');
		expect(r.cor).toBe('desconhecida');
		expect(String(r.notas)).toContain('ficha do filamento nao foi encontrada');
		expect(r.codigo).toBe('DESCON-DESCONHE-01');
	});

	it('banco vazio migra sem reclamar', () => {
		fundir(sqlite);
		expect(todos('SELECT * FROM rolo')).toEqual([]);
	});

	it('o autoincremento continua depois do maior id, incluindo o órfão criado', () => {
		sqlite.exec(`
			INSERT INTO filamento (id, marca, material, cor) VALUES (1,'A','PLA','Preto'),(2,'B','PLA','Azul');
			INSERT INTO rolo (id, filamento_id, preco_pago_cents) VALUES (5,1,100);
		`);
		fundir(sqlite);

		// O filamento 2 não tinha rolo: virou o rolo 6, e o próximo insert tem
		// que sair no 7 — não em cima de nada.
		expect(todos('SELECT id FROM rolo ORDER BY id').map((r) => r.id)).toEqual([5, 6]);
		sqlite.exec(`INSERT INTO rolo (codigo, marca, material, cor) VALUES ('X-Y-01','a','b','c')`);
		expect(um("SELECT id FROM rolo WHERE codigo = 'X-Y-01'").id).toBe(7);
	});
});
