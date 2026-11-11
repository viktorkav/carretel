/**
 * Testes das ACTIONS contra envio repetido — o item 1 da crítica.
 *
 * São de action, e não de helper, porque o defeito nunca esteve na lógica:
 * esteve na FIAÇÃO. `registrarEnvio` sozinho já sabia dizer "repetido"; o que
 * faltava era alguém perguntar antes de escrever, e perguntar no lugar certo
 * (imediatamente antes do insert, sem `await` no meio). Um teste de helper
 * passa feliz com a action gravando duas vezes.
 *
 * O caso que dá nome ao achado — dois POST no mesmo milissegundo — está aqui
 * como `Promise.all`, sem `await` entre um e outro.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'carretel-envio-')), 'teste.sqlite');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { CAMPO_ENVIO, esquecerEnvios, novoEnvio } = await import('$lib/server/envio');
const rolos = (await import('./rolos/+page.server')).actions;
const impressoes = (await import('./impressoes/+page.server')).actions;

let ids: { impressoraId: number; roloId: number };

beforeEach(() => {
	esquecerEnvios();
	db.delete(schema.impressao).run();
	db.delete(schema.afericao).run();
	db.delete(schema.rolo).run();
	db.delete(schema.impressora).run();
	db.delete(schema.config).run();
	db.insert(schema.config).values({ id: 1, tarifaKwhCents: 95 }).run();

	const [imp] = db
		.insert(schema.impressora)
		.values({ nome: 'A1', modelo: 'Bambu Lab A1', precoCompraCents: 250_000 })
		.returning()
		.all();
	const [rol] = db
		.insert(schema.rolo)
		.values({
			codigo: 'PLA-PRETO-01',
			marca: 'Bambu',
			material: 'PLA',
			cor: 'Preto',
			precoPagoCents: 12_000,
			pesoLiquidoInicialG: 1000,
			status: 'aberto'
		})
		.returning()
		.all();

	ids = { impressoraId: imp.id, roloId: rol.id };
});

function evento(campos: Record<string, string>) {
	const corpo = new FormData();
	for (const [chave, valor] of Object.entries(campos)) corpo.set(chave, valor);
	return {
		request: new Request('http://localhost/', { method: 'POST', body: corpo }),
		params: {}
	} as never;
}

type Retorno = { status?: number; data?: { erro?: string }; repetido?: boolean; [k: string]: unknown };

const chamar = (action: (ev: never) => unknown, campos: Record<string, string>) =>
	action(evento(campos)) as Promise<Retorno>;

const afericoes = () => db.select().from(schema.afericao).all();
const listaDeRolos = () => db.select().from(schema.rolo).all();
const listaDeImpressoes = () => db.select().from(schema.impressao).all();

// ── ?/aferir — a âncora do estoque ──────────────────────────────────────────

describe('/rolos ?/aferir', () => {
	const pesagem = (envio: string) => ({
		roloId: String(ids.roloId),
		pesoLiquidoG: '742',
		[CAMPO_ENVIO]: envio
	});

	it('o toque duplo grava UMA aferição', async () => {
		const envio = novoEnvio();
		await chamar(rolos.aferir, pesagem(envio));
		const segunda = await chamar(rolos.aferir, pesagem(envio));

		expect(afericoes()).toHaveLength(1);
		expect(segunda.repetido).toBe(true);
	});

	// O relato original: duas requisições no mesmo milissegundo.
	it('dois POST concorrentes gravam UMA aferição', async () => {
		const envio = novoEnvio();
		const [a, b] = await Promise.all([
			chamar(rolos.aferir, pesagem(envio)),
			chamar(rolos.aferir, pesagem(envio))
		]);

		expect(afericoes()).toHaveLength(1);
		expect([a.repetido, b.repetido].filter(Boolean)).toHaveLength(1);
	});

	it('o envio repetido responde SUCESSO, e não erro', async () => {
		const envio = novoEnvio();
		await chamar(rolos.aferir, pesagem(envio));
		const segunda = await chamar(rolos.aferir, pesagem(envio));

		// A pesagem está gravada: dizer "deu errado" faria o usuário digitar de
		// novo, que é como o fantasma nasceria de outro jeito.
		expect(segunda.status).toBeUndefined();
		expect(segunda.sucesso).toBe(true);
		expect(String(segunda.aviso)).toMatch(/já tinha sido registrada/);
	});

	it('duas pesagens de verdade, cada uma com seu token, entram as duas', async () => {
		await chamar(rolos.aferir, pesagem(novoEnvio()));
		await chamar(rolos.aferir, pesagem(novoEnvio()));

		expect(afericoes()).toHaveLength(2);
	});

	it('formulário sem token continua gravando — página antiga não vira erro', async () => {
		await chamar(rolos.aferir, { roloId: String(ids.roloId), pesoLiquidoG: '742' });
		expect(afericoes()).toHaveLength(1);
	});

	it('envio recusado não queima o token: dá para corrigir e reenviar', async () => {
		const envio = novoEnvio();
		const ruim = await chamar(rolos.aferir, {
			roloId: String(ids.roloId),
			pesoLiquidoG: '',
			[CAMPO_ENVIO]: envio
		});
		expect(ruim.status).toBe(400);

		await chamar(rolos.aferir, pesagem(envio));
		expect(afericoes()).toHaveLength(1);
	});
});

// ── ?/criar do rolo — cada compra é uma linha, mas um envio é um envio ──────

describe('/rolos ?/criar', () => {
	const cadastro = (envio: string) => ({
		marca: 'Bambu',
		material: 'PLA',
		cor: 'Preto',
		densidade: '1,24',
		preco: '129,90',
		pesoInicial: '1000',
		pesoCarretel: '250',
		[CAMPO_ENVIO]: envio
	});

	it('o toque duplo cadastra UM filamento', async () => {
		const envio = novoEnvio();
		await chamar(rolos.criar, cadastro(envio));
		await chamar(rolos.criar, cadastro(envio));

		expect(listaDeRolos()).toHaveLength(2); // o do beforeEach + um
	});

	it('dois POST concorrentes cadastram UM filamento', async () => {
		const envio = novoEnvio();
		await Promise.all([chamar(rolos.criar, cadastro(envio)), chamar(rolos.criar, cadastro(envio))]);

		expect(listaDeRolos()).toHaveLength(2);
	});

	/**
	 * A regra que a fusão comprou e que nenhuma trava pode desfazer: comprar
	 * dois carretéis iguais na mesma nota são DOIS registros. Por isso o
	 * reconhecimento é por envio, e não por "os campos são iguais".
	 */
	it('dois cadastros idênticos com tokens diferentes continuam sendo dois rolos', async () => {
		await chamar(rolos.criar, cadastro(novoEnvio()));
		await chamar(rolos.criar, cadastro(novoEnvio()));

		expect(listaDeRolos()).toHaveLength(3);
	});
});

// ── ?/criar da impressão — o débito do rolo ─────────────────────────────────

describe('/impressoes ?/criar', () => {
	const registro = (envio: string) => ({
		nomeLivre: 'MagicTray',
		impressoraId: String(ids.impressoraId),
		roloId: String(ids.roloId),
		gramas: '31,5',
		duracao: '1:40',
		[CAMPO_ENVIO]: envio
	});

	it('o toque duplo registra UMA impressão', async () => {
		const envio = novoEnvio();
		await chamar(impressoes.criar, registro(envio));
		const segunda = await chamar(impressoes.criar, registro(envio));

		expect(listaDeImpressoes()).toHaveLength(1);
		expect(segunda.repetido).toBe(true);
	});

	it('dois POST concorrentes registram UMA impressão', async () => {
		const envio = novoEnvio();
		await Promise.all([
			chamar(impressoes.criar, registro(envio)),
			chamar(impressoes.criar, registro(envio))
		]);

		expect(listaDeImpressoes()).toHaveLength(1);
	});

	it('e o rolo é debitado uma vez só', async () => {
		const envio = novoEnvio();
		await chamar(impressoes.criar, registro(envio));
		await chamar(impressoes.criar, registro(envio));

		const soma = listaDeImpressoes().reduce((s, i) => s + i.gramas, 0);
		expect(soma).toBe(31.5);
	});

	it('imprimir a mesma peça de novo, com token novo, continua entrando', async () => {
		await chamar(impressoes.criar, registro(novoEnvio()));
		await chamar(impressoes.criar, registro(novoEnvio()));

		expect(listaDeImpressoes()).toHaveLength(2);
	});
});

// ── o token chega à tela ────────────────────────────────────────────────────

describe('o formulário recebe um token novo a cada renderização', () => {
	it('/rolos', async () => {
		const load = (await import('./rolos/+page.server')).load;
		const evento = { url: new URL('http://localhost/rolos'), cookies: { get: () => undefined } };
		const a = (await load(evento as never)) as { envio: string };
		const b = (await load(evento as never)) as { envio: string };

		expect(a.envio).toBeTruthy();
		expect(a.envio).not.toBe(b.envio);
	});

	it('/impressoes', async () => {
		const load = (await import('./impressoes/+page.server')).load;
		const evento = {
			url: new URL('http://localhost/impressoes'),
			cookies: { get: () => undefined, set: () => {} }
		};
		const a = (await load(evento as never)) as { envio: string };
		const b = (await load(evento as never)) as { envio: string };

		expect(a.envio).toBeTruthy();
		expect(a.envio).not.toBe(b.envio);
	});
});
