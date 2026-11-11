/**
 * A FIAÇÃO do recorte de `/impressoes`, e não as regras dele.
 *
 * As regras estão travadas em `src/lib/recorte.test.ts`, sem SvelteKit e sem
 * banco. O que só aparece aqui é o que o `load` faz com elas: montar a consulta
 * certa, somar o recorte INTEIRO (e não a página), fatiar a página, e continuar
 * entregando a tela quando a query é lixo.
 *
 * Três falhas possíveis não seriam pegas por nenhum teste de helper:
 *
 * 1. o `load` filtrar pela coluna errada (ou esquecer de aplicar um filtro) —
 *    os helpers passariam felizes e a tela mostraria a lista inteira;
 * 2. o subtotal ser calculado depois do fatiamento — o número mudaria ao virar
 *    de página, que é a pior coisa que um total pode fazer;
 * 3. o filtro de rolo aceitar id que a tela não oferece, devolvendo tela vazia
 *    sem nada de errado à vista.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'carretel-recorte-')), 'teste.sqlite');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { load } = await import('./+page.server');

const DIA = 86_400_000;

interface Semente {
	nome: string;
	diasAtras: number;
	finalidade: 'estudio' | 'homelab' | 'conteudo' | 'pessoal' | 'outro';
	status: 'sucesso' | 'falha' | 'cancelada';
	rolo: number;
	cents: number;
	gramas: number;
}

let idImpressora = 0;
const idRolo: number[] = [];

function semear(linhas: Semente[]) {
	const agora = Date.now();
	for (const l of linhas) {
		db.insert(schema.impressao)
			.values({
				nomeLivre: l.nome,
				impressoraId: idImpressora,
				roloId: idRolo[l.rolo],
				inicioEm: new Date(agora - l.diasAtras * DIA),
				duracaoS: 3600,
				gramas: l.gramas,
				status: l.status,
				finalidade: l.finalidade,
				origem: 'manual',
				custoTotalCents: l.cents
			})
			.run();
	}
}

interface Retorno {
	impressoes: { id: number; nomeLivre: string }[];
	recorte: {
		periodo: string;
		finalidade: string;
		status: string;
		roloId: number | null;
		busca: string;
		filtrando: boolean;
	};
	total: { impressoes: number; custoTotalCents: number; gramas: number };
	pagina: { pagina: number; totalPaginas: number };
	rolosDoFiltro: { id: number }[];
}

async function abrir(busca: string) {
	const cookies = {
		get: () => undefined,
		set: () => {},
		delete: () => {},
		getAll: () => [],
		serialize: () => ''
	};
	return (await load({
		url: new URL(`http://192.0.2.10:3316/impressoes${busca}`),
		cookies
	} as never)) as unknown as Retorno;
}

const nomes = (r: Retorno) => r.impressoes.map((i) => i.nomeLivre);

beforeEach(() => {
	db.delete(schema.impressao).run();
	db.delete(schema.rolo).run();
	db.delete(schema.impressora).run();
	db.delete(schema.config).run();
	db.insert(schema.config).values({ id: 1, tarifaKwhCents: 95 }).run();

	const [imp] = db
		.insert(schema.impressora)
		.values({ nome: 'A1', modelo: 'Bambu Lab A1', precoCompraCents: 400000 })
		.returning()
		.all();
	idImpressora = imp.id;

	idRolo.length = 0;
	for (const codigo of ['PLA-PRETO-01', 'PLA-IVORY-01']) {
		const [r] = db
			.insert(schema.rolo)
			.values({
				codigo,
				marca: 'Bambu',
				material: 'PLA',
				cor: 'Preto',
				precoPagoCents: 12000,
				// O segundo rolo entra VAZIO de propósito: o filtro do histórico
				// tem que oferecer rolo que já acabou.
				status: codigo === 'PLA-IVORY-01' ? 'vazio' : 'aberto'
			})
			.returning()
			.all();
		idRolo.push(r.id);
	}
});

describe('load de /impressoes — sem recorte', () => {
	it('entrega tudo, sem o teto de cem que existia antes', () => {
		semear(
			Array.from({ length: 120 }, (_, n) => ({
				nome: `peça ${n}`,
				diasAtras: n,
				finalidade: 'outro' as const,
				status: 'sucesso' as const,
				rolo: 0,
				cents: 100,
				gramas: 1
			}))
		);
		return abrir('').then((r) => {
			expect(r.total.impressoes).toBe(120);
			expect(r.pagina.totalPaginas).toBe(3);
			expect(r.recorte.filtrando).toBe(false);
		});
	});
});

describe('load de /impressoes — cada filtro morde a coluna certa', () => {
	beforeEach(() => {
		semear([
			{ nome: 'MagicTray', diasAtras: 1, finalidade: 'estudio', status: 'sucesso', rolo: 0, cents: 605, gramas: 47.7 },
			{ nome: 'MagicTray', diasAtras: 2, finalidade: 'estudio', status: 'falha', rolo: 0, cents: 689, gramas: 54.3 },
			{ nome: 'Gridfinity', diasAtras: 3, finalidade: 'homelab', status: 'sucesso', rolo: 1, cents: 391, gramas: 29.4 },
			{ nome: 'Caixa do Rode', diasAtras: 200, finalidade: 'conteudo', status: 'sucesso', rolo: 1, cents: 1900, gramas: 149 }
		]);
	});

	it('período corta pela data de início', async () => {
		expect(nomes(await abrir('?periodo=7')).sort()).toEqual(['Gridfinity', 'MagicTray', 'MagicTray']);
		expect((await abrir('?periodo=365')).total.impressoes).toBe(4);
	});

	it('finalidade corta pela finalidade, e não pelo status', async () => {
		const r = await abrir('?finalidade=estudio');
		expect(r.total.impressoes).toBe(2);
		expect(nomes(r)).toEqual(['MagicTray', 'MagicTray']);
	});

	it('status corta pelo status', async () => {
		expect((await abrir('?status=falha')).total.impressoes).toBe(1);
		expect((await abrir('?status=sucesso')).total.impressoes).toBe(3);
	});

	it('rolo corta pelo rolo — inclusive um que já acabou', async () => {
		const r = await abrir(`?rolo=${idRolo[1]}`);
		expect(r.recorte.roloId).toBe(idRolo[1]);
		expect(nomes(r).sort()).toEqual(['Caixa do Rode', 'Gridfinity']);
	});

	it('rolo que a tela não oferece não recorta nada — tela vazia sem motivo é pior', async () => {
		const r = await abrir('?rolo=99999');
		expect(r.recorte.roloId).toBe(null);
		expect(r.total.impressoes).toBe(4);
	});

	it('busca acha pedaço do nome, sem ligar para caixa nem acento', async () => {
		expect((await abrir('?q=tray')).total.impressoes).toBe(2);
		expect((await abrir('?q=RODE')).total.impressoes).toBe(1);
		expect((await abrir('?q=caixa+do+rode')).total.impressoes).toBe(1);
	});

	it('os filtros se somam em vez de se substituírem', async () => {
		const r = await abrir('?finalidade=estudio&status=sucesso&q=magic');
		expect(r.total.impressoes).toBe(1);
		expect(r.total.custoTotalCents).toBe(605);
	});

	it('oferece todos os rolos no filtro, inclusive o vazio', async () => {
		expect((await abrir('')).rolosDoFiltro.map((r) => r.id).sort()).toEqual([...idRolo].sort());
	});
});

describe('load de /impressoes — o subtotal é do recorte, não da página', () => {
	beforeEach(() => {
		semear([
			{ nome: 'MagicTray', diasAtras: 1, finalidade: 'estudio', status: 'sucesso', rolo: 0, cents: 605, gramas: 47.72 },
			{ nome: 'MagicTray', diasAtras: 2, finalidade: 'estudio', status: 'sucesso', rolo: 0, cents: 689, gramas: 54.29 },
			{ nome: 'MagicTray', diasAtras: 3, finalidade: 'estudio', status: 'sucesso', rolo: 0, cents: 752, gramas: 59.4 },
			{ nome: 'MagicTray', diasAtras: 4, finalidade: 'estudio', status: 'sucesso', rolo: 0, cents: 660, gramas: 52.15 },
			{ nome: 'Outra', diasAtras: 5, finalidade: 'pessoal', status: 'sucesso', rolo: 1, cents: 9999, gramas: 500 }
		]);
	});

	it('soma só o que o recorte pegou', async () => {
		const r = await abrir('?q=magictray');
		expect(r.total).toEqual({ impressoes: 4, custoTotalCents: 2706, gramas: 213.6 });
	});

	it('o total não muda ao virar de página', async () => {
		const p1 = await abrir('?pagina=1');
		const p2 = await abrir('?pagina=2');
		expect(p2.total).toEqual(p1.total);
		expect(p1.total.impressoes).toBe(5);
	});
});

describe('load de /impressoes — paginação alcança o histórico inteiro', () => {
	beforeEach(() => {
		semear(
			Array.from({ length: 120 }, (_, n) => ({
				nome: `peça ${String(n).padStart(3, '0')}`,
				diasAtras: n,
				finalidade: 'outro' as const,
				status: 'sucesso' as const,
				rolo: 0,
				cents: 100,
				gramas: 1
			}))
		);
	});

	it('a primeira página traz as cinquenta mais recentes', async () => {
		const r = await abrir('');
		expect(r.impressoes).toHaveLength(50);
		expect(nomes(r)[0]).toBe('peça 000');
	});

	it('a última página alcança a impressão mais antiga — a de número 120', async () => {
		const r = await abrir('?pagina=3');
		expect(r.impressoes).toHaveLength(20);
		expect(nomes(r).at(-1)).toBe('peça 119');
	});

	it('página além do fim volta para a última, em vez de tela vazia', async () => {
		const r = await abrir('?pagina=99');
		expect(r.pagina.pagina).toBe(3);
		expect(r.impressoes).toHaveLength(20);
	});

	it('o filtro reduz o número de páginas', async () => {
		expect((await abrir('?q=peça 01')).pagina.totalPaginas).toBe(1);
	});
});

describe('load de /impressoes — query hostil não derruba a tela', () => {
	beforeEach(() => {
		semear([
			{ nome: 'MagicTray', diasAtras: 1, finalidade: 'estudio', status: 'sucesso', rolo: 0, cents: 605, gramas: 47.7 }
		]);
	});

	const hostis = [
		'?periodo=-1',
		'?periodo=1e999',
		'?finalidade=' + encodeURIComponent("' OR 1=1 --"),
		'?status=' + encodeURIComponent('<script>alert(1)</script>'),
		'?rolo=' + encodeURIComponent('1; drop table impressao'),
		'?rolo=0',
		'?pagina=-5',
		'?pagina=' + '9'.repeat(400),
		'?q=' + encodeURIComponent('%'),
		'?q=' + encodeURIComponent('_'),
		'?q=' + 'a'.repeat(5000),
		'?periodo[]=30&status[]=falha'
	];

	for (const busca of hostis) {
		it(`responde com a tela inteira em "${busca.slice(0, 40)}"`, async () => {
			const r = await abrir(busca);
			expect(r.total.impressoes).toBeGreaterThanOrEqual(0);
			expect(r.pagina.pagina).toBeGreaterThanOrEqual(1);
			expect(Array.isArray(r.impressoes)).toBe(true);
			expect(Array.isArray(r.rolosDoFiltro)).toBe(true);
		});
	}

	it('`%` e `_` na busca são texto, não curinga de SQL', async () => {
		// Se a busca virasse LIKE sem escape, `%` acharia tudo.
		expect((await abrir('?q=' + encodeURIComponent('%'))).total.impressoes).toBe(0);
		expect((await abrir('?q=' + encodeURIComponent('_'))).total.impressoes).toBe(0);
	});

	it('a tabela do banco continua de pé depois de tudo isso', async () => {
		expect((await abrir('')).total.impressoes).toBe(1);
	});
});
