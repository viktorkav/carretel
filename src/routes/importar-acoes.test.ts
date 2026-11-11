/**
 * Testes das ACTIONS de importação — itens 2, 3 e 4 da crítica, ponta a ponta.
 *
 * O que estes testes pegam e um teste de helper não pega é a FIAÇÃO: o total
 * vitalício sair do cliente HTTP e chegar até a conferência da tela; o peso
 * digitado na linha atravessar `lerEntradasDoFormulario` e virar a coluna
 * `gramas`; a densidade do rolo entrar no cálculo no meio do lote. Cada um
 * desses caminhos tem uma emenda, e é na emenda que o bug morava.
 *
 * **Nenhuma chamada autenticada.** O `fetch` global é trocado por uma nuvem de
 * mentira; qualquer endereço fora da API responde 404, para nenhum download de
 * capa tocar a rede nem o disco de verdade.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const temporario = mkdtempSync(join(tmpdir(), 'carretel-importar-'));
process.env.DATABASE_PATH = join(temporario, 'teste.sqlite');
process.env.UPLOADS_PATH = join(temporario, 'uploads');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { criarNuvemFalsa, criarPerfilBruto, criarTarefaBruta } = await import(
	'$lib/server/nuvem/fixtures'
);
const importar = (await import('./importar/+page.server')).actions;

const TOKEN = 'token-de-mentira';
const fetchDeVerdade = globalThis.fetch;

/**
 * Instala a nuvem falsa no `fetch` global.
 *
 * Tudo que não for `api.bambulab.com` responde 404 — inclusive a URL da capa.
 * A importação trata capa que não baixa como capa que não veio, então o teste
 * exercita o caminho inteiro sem escrever imagem nenhuma.
 */
function instalarNuvem(opcoes: Parameters<typeof criarNuvemFalsa>[0]) {
	const { fetchFalso } = criarNuvemFalsa(opcoes);
	globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
		const url = String(entrada);
		if (!url.startsWith('https://api.bambulab.com')) return new Response('', { status: 404 });
		return fetchFalso(entrada as never, init);
	}) as typeof fetch;
}

let ids: { impressoraId: number; roloId: number };

beforeEach(() => {
	db.delete(schema.impressao).run();
	db.delete(schema.afericao).run();
	db.delete(schema.rolo).run();
	db.delete(schema.impressora).run();
	db.delete(schema.config).run();
	db.insert(schema.config).values({ id: 1, tarifaKwhCents: 95, tokenNuvem: TOKEN }).run();

	const [imp] = db
		.insert(schema.impressora)
		.values({
			nome: 'A1',
			modelo: 'Bambu Lab A1',
			apelidoBambu: 'Unit-01(A1)',
			precoCompraCents: 250_000,
			vidaUtilHoras: 5000,
			potenciaMediaW: 100
		})
		.returning()
		.all();
	// Densidade REAL 1,31 — as tarefas da nuvem são fatiadas a 1,24.
	const [rol] = db
		.insert(schema.rolo)
		.values({
			codigo: 'PLA-PRETO-01',
			marca: 'Bambu',
			material: 'PLA',
			cor: 'Preto',
			corHex: '#000000',
			codigoBambu: 'GFA18',
			densidade: 1.31,
			precoPagoCents: 12_000,
			pesoLiquidoInicialG: 1000,
			status: 'aberto'
		})
		.returning()
		.all();

	ids = { impressoraId: imp.id, roloId: rol.id };
});

afterEach(() => {
	globalThis.fetch = fetchDeVerdade;
});

function evento(campos: Record<string, string> = {}) {
	const corpo = new FormData();
	for (const [chave, valor] of Object.entries(campos)) corpo.set(chave, valor);
	return {
		request: new Request('http://localhost/importar', { method: 'POST', body: corpo })
	} as never;
}

type Conferencia = {
	pesoNuvemG: number | null;
	pesoColhidoG: number;
	deltaPesoG: number | null;
	pesoDiverge: boolean;
	tempoNuvemS: number | null;
};

const impressoes = () => db.select().from(schema.impressao).all();

// ── item 4: a conferência de importação ────────────────────────────────────

describe('?/buscar — reconciliação com o total da conta', () => {
	it('o total vitalício chega até a tela', async () => {
		instalarNuvem({
			tarefas: [criarTarefaBruta({ id: 1, weight: 100 })],
			perfil: criarPerfilBruto({ taskWeightSum: 623.33, taskTimeSum: 70_812 })
		});

		const r = (await importar.buscar(evento())) as { conferencia: Conferencia };

		// Antes da correção este número era `null` em toda importação, e a rede
		// de segurança contra leitura truncada nunca disparou.
		expect(r.conferencia.pesoNuvemG).toBe(623.33);
		expect(r.conferencia.tempoNuvemS).toBe(70_812);
	});

	it('mede a distância entre o lido e o somado pela conta', async () => {
		instalarNuvem({
			tarefas: [criarTarefaBruta({ id: 1, weight: 624 })],
			perfil: criarPerfilBruto({ taskWeightSum: 623.33 })
		});

		const r = (await importar.buscar(evento())) as { conferencia: Conferencia };

		expect(r.conferencia.deltaPesoG).toBeCloseTo(0.67, 2);
		expect(r.conferencia.pesoDiverge).toBe(false);
	});

	it('acusa quando a leitura ficou longe do total da conta', async () => {
		instalarNuvem({
			tarefas: [criarTarefaBruta({ id: 1, weight: 100 })],
			perfil: criarPerfilBruto({ taskWeightSum: 623.33 })
		});

		const r = (await importar.buscar(evento())) as { conferencia: Conferencia };

		expect(r.conferencia.pesoDiverge).toBe(true);
	});

	it('sobrevive à conta que não devolve os totais', async () => {
		instalarNuvem({
			tarefas: [criarTarefaBruta({ id: 1, weight: 100 })],
			perfil: { uid: 1 }
		});

		const r = (await importar.buscar(evento())) as { conferencia: Conferencia };

		expect(r.conferencia.pesoNuvemG).toBeNull();
		expect(r.conferencia.deltaPesoG).toBeNull();
		expect(r.conferencia.pesoDiverge).toBe(false);
	});
});

// ── itens 2 e 3: o peso que entra no banco ─────────────────────────────────

describe('?/gravar — de onde saem as gramas', () => {
	const concluida = () => criarTarefaBruta({ id: 4242, weight: 82.5, designTitle: 'MagicTray' });
	const abortada = () =>
		criarTarefaBruta({
			id: 4343,
			designTitle: 'Base do ventilador',
			status: 3,
			startTime: '2026-08-09T10:00:00Z',
			endTime: '2026-08-09T10:03:00Z',
			costTime: 18_000,
			weight: 202.67
		});

	const linha = (taskId: string) => ({
		[`rolo:${taskId}`]: String(ids.roloId),
		[`impressora:${taskId}`]: String(ids.impressoraId),
		finalidade: 'estudio'
	});

	it('a peça concluída entra com o peso refeito pela densidade do rolo', async () => {
		instalarNuvem({ tarefas: [concluida()] });

		const r = (await importar.gravar(evento(linha('4242')))) as {
			resultado: { gravadas: number; recalculadasPorDensidade: number };
		};

		expect(r.resultado.gravadas).toBe(1);
		expect(r.resultado.recalculadasPorDensidade).toBe(1);
		// 82,5 g fatiados a 1,24 num rolo de 1,31 são 87,16 g de material.
		expect(impressoes()[0].gramas).toBeCloseTo(87.16, 1);
	});

	it('a peça abortada NÃO entra com o peso cheio da nuvem', async () => {
		instalarNuvem({ tarefas: [abortada()] });

		const r = (await importar.gravar(evento(linha('4343')))) as {
			resultado: { gravadas: number; puladas: { motivo: string }[] };
		};

		expect(r.resultado.gravadas).toBe(0);
		expect(r.resultado.puladas[0].motivo).toMatch(/estimativa cheia/);
		expect(impressoes()).toHaveLength(0);
	});

	it('a peça abortada entra com o peso digitado na linha', async () => {
		instalarNuvem({ tarefas: [abortada()] });

		const r = (await importar.gravar(
			evento({ ...linha('4343'), 'gramas:4343': '2,4' })
		)) as { resultado: { gravadas: number; comPesoDigitado: number } };

		expect(r.resultado.gravadas).toBe(1);
		expect(r.resultado.comPesoDigitado).toBe(1);
		expect(impressoes()[0].gramas).toBe(2.4);
		// E o peso digitado é medida: a densidade não o reescreve por cima.
		expect(impressoes()[0].observacoes).toMatch(/abortou/);
	});

	it('uma abortada sem peso não derruba as outras do lote', async () => {
		instalarNuvem({ tarefas: [concluida(), abortada()] });

		const r = (await importar.gravar(
			evento({ ...linha('4242'), ...linha('4343') })
		)) as { resultado: { gravadas: number; puladas: unknown[] } };

		expect(r.resultado.gravadas).toBe(1);
		expect(r.resultado.puladas).toHaveLength(1);
		expect(impressoes()).toHaveLength(1);
	});

	it('mantém o peso da nuvem quando peso e comprimento não fecham', async () => {
		instalarNuvem({ tarefas: [criarTarefaBruta({ id: 4444, weight: 82.5, length: 27_600 })] });

		const r = (await importar.gravar(evento(linha('4444')))) as {
			resultado: { gravadas: number; recalculadasPorDensidade: number };
		};

		expect(r.resultado.gravadas).toBe(1);
		expect(r.resultado.recalculadasPorDensidade).toBe(0);
		expect(impressoes()[0].gramas).toBe(82.5);
	});
});

// ── a ação que completa a plate e o projeto do histórico já importado ───────

describe('?/completar — preenche o que falta nas tarefas já importadas', () => {
	const linha = (taskId: string) => ({
		[`rolo:${taskId}`]: String(ids.roloId),
		[`impressora:${taskId}`]: String(ids.impressoraId),
		finalidade: 'estudio'
	});

	/** Grava uma impressão como as 11 de produção: sem plate e sem projeto. */
	function importadaSemPlate(taskId: number, over: Record<string, unknown> = {}) {
		instalarNuvem({
			tarefas: [criarTarefaBruta({ id: taskId, plateIndex: null, designId: 0, ...over })]
		});
		return importar.gravar(evento(linha(String(taskId))));
	}

	it('busca o histórico e escreve as duas colunas na linha que já existe', async () => {
		await importadaSemPlate(5151);
		expect(impressoes()[0].indicePlate).toBeNull();

		// A nuvem agora devolve os campos — é o mesmo endereço, outro parser.
		instalarNuvem({ tarefas: [criarTarefaBruta({ id: 5151, plateIndex: 4, designId: 77_881 })] });
		const r = (await importar.completar(evento())) as {
			completou: { pendentes: number; completadas: number; indices: number; projetos: number };
		};

		expect(r.completou).toMatchObject({ pendentes: 1, completadas: 1, indices: 1, projetos: 1 });
		expect(impressoes()[0].indicePlate).toBe(4);
		expect(impressoes()[0].projetoIdNuvem).toBe('77881');
	});

	it('⚠️ não mexe em custo congelado, rolo, finalidade, gramas nem duração', async () => {
		await importadaSemPlate(5252);
		const antes = impressoes()[0];

		instalarNuvem({ tarefas: [criarTarefaBruta({ id: 5252, plateIndex: 4, designId: 77_881 })] });
		await importar.completar(evento());
		const depois = impressoes()[0];

		const semPlate = (l: typeof antes) => {
			const { indicePlate, projetoIdNuvem, ...resto } = l;
			void indicePlate;
			void projetoIdNuvem;
			return resto;
		};
		expect(semPlate(depois)).toEqual(semPlate(antes));
		expect(depois.custoTotalCents).toBe(antes.custoTotalCents);
	});

	// É a razão de a ação existir: reimportar NÃO resolve, porque a dedupe pelo
	// id da tarefa pula quem já está gravado.
	it('reimportar continua não resolvendo — e é por isso que a ação existe', async () => {
		await importadaSemPlate(5353);

		instalarNuvem({ tarefas: [criarTarefaBruta({ id: 5353, plateIndex: 4, designId: 77_881 })] });
		const r = (await importar.gravar(evento(linha('5353')))) as {
			resultado: { gravadas: number; duplicadas: number };
		};

		expect(r.resultado).toMatchObject({ gravadas: 0, duplicadas: 1 });
		expect(impressoes()[0].indicePlate).toBeNull();
	});

	it('sem token responde 400 com o caminho da solução, e não 500', async () => {
		db.update(schema.config).set({ tokenNuvem: null }).run();
		const r = (await importar.completar(evento())) as { status: number; data: { erro: string } };

		expect(r.status).toBe(400);
		expect(r.data.erro).toMatch(/token/i);
	});

	it('nuvem fora do ar vira 502 com mensagem, e nada é escrito', async () => {
		await importadaSemPlate(5454);
		globalThis.fetch = (async () => {
			throw new TypeError('fetch failed');
		}) as typeof fetch;

		const r = (await importar.completar(evento())) as { status: number; data: { erro: string } };

		expect(r.status).toBe(502);
		expect(impressoes()[0].indicePlate).toBeNull();
	});

	it('o passivo aparece no load, e some depois de resolvido', async () => {
		const { load } = await import('./importar/+page.server');
		await importadaSemPlate(5555);
		expect(((await load({} as never)) as unknown as { semPlate: number }).semPlate).toBe(1);

		instalarNuvem({ tarefas: [criarTarefaBruta({ id: 5555, plateIndex: 4, designId: 77_881 })] });
		await importar.completar(evento());

		expect(((await load({} as never)) as unknown as { semPlate: number }).semPlate).toBe(0);
	});
});
