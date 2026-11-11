/**
 * A FIAÇÃO da escolha de visualização, e não só as regras dela.
 *
 * As regras estão travadas em `src/lib/visualizacao.test.ts`, sem SvelteKit.
 * O que só aparece aqui é o que o `load` faz com elas: ler a query certa, ler o
 * cookie certo, gravar o cookie com as opções certas — e continuar entregando a
 * lista de impressões mesmo quando a query é lixo.
 *
 * Duas falhas possíveis não seriam pegas por nenhum teste de helper:
 *
 * 1. o `load` ler o parâmetro errado (ou esquecer de ler o cookie) — os
 *    helpers passariam felizes, e a preferência simplesmente não seria lembrada;
 * 2. o cookie sair com `secure: true`, que é o PADRÃO do SvelteKit fora de
 *    `localhost`. Em produção o Carretel é `http://192.0.2.10:3316`: o
 *    navegador descartaria o cookie em silêncio e a preferência nunca colaria,
 *    enquanto no `npm run dev` (localhost) tudo pareceria funcionar.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeEach, describe, expect, it } from 'vitest';

// O módulo de banco resolve o arquivo na carga: o caminho precisa estar no
// ambiente ANTES do import.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'carretel-visao-')), 'teste.sqlite');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { registrarImpressao } = await import('$lib/server/repo');
const { COOKIE_VISUALIZACAO } = await import('$lib/visualizacao');
const { load } = await import('./+page.server');

const INICIO = 1_754_700_000_000;

interface Gravacao {
	nome: string;
	valor: string;
	opcoes: Record<string, unknown>;
}

/** O mínimo de `cookies` que o `load` toca, com as escritas registradas. */
function bancada(guardado?: string) {
	const gravado: Gravacao[] = [];
	const cookies = {
		get: (nome: string) => (nome === COOKIE_VISUALIZACAO ? guardado : undefined),
		set: (nome: string, valor: string, opcoes: Record<string, unknown>) => {
			gravado.push({ nome, valor, opcoes });
		},
		delete: () => {},
		getAll: () => [],
		serialize: () => ''
	};
	return { gravado, cookies };
}

type Retorno = { visualizacao: string; impressoes: unknown[]; temMiniaturas: boolean };

async function abrir(busca: string, guardado?: string) {
	const { gravado, cookies } = bancada(guardado);
	const dados = (await load({
		url: new URL(`http://192.0.2.10:3316/impressoes${busca}`),
		cookies
	} as never)) as unknown as Retorno;
	return { dados, gravado };
}

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
	// Depois da fusão, a ficha do filamento mora no próprio rolo.
	const [rol] = db
		.insert(schema.rolo)
		.values({
			codigo: 'PLA-PRETO-01',
			marca: 'Bambu',
			material: 'PLA',
			cor: 'Preto',
			precoPagoCents: 12000,
			status: 'aberto'
		})
		.returning()
		.all();

	registrarImpressao(db, {
		nomeLivre: 'caixa de parafuso',
		impressoraId: imp.id,
		roloId: rol.id,
		inicioEm: INICIO,
		duracaoS: 3600,
		gramas: 100,
		status: 'sucesso',
		finalidade: 'estudio',
		origem: 'manual'
	});
});

describe('load de /impressoes — visualização', () => {
	it('abre em GRADE quando não há query nem cookie', async () => {
		const { dados } = await abrir('');
		expect(dados.visualizacao).toBe('grade');
	});

	it('lê o parâmetro `ver` da query', async () => {
		expect((await abrir('?ver=lista')).dados.visualizacao).toBe('lista');
		expect((await abrir('?ver=grade')).dados.visualizacao).toBe('grade');
	});

	it('lembra a escolha guardada no cookie quando a query está limpa', async () => {
		expect((await abrir('', 'lista')).dados.visualizacao).toBe('lista');
	});

	it('a query vence o cookie', async () => {
		expect((await abrir('?ver=grade', 'lista')).dados.visualizacao).toBe('grade');
	});

	// O `load` também recebe `excluida` na URL depois de uma exclusão. Ele não
	// pode confundir um parâmetro com o outro.
	it('não confunde outro parâmetro com o de visualização', async () => {
		const { dados } = await abrir('?excluida=caixa&modo=lista&view=lista', 'lista');
		expect(dados.visualizacao).toBe('lista'); // do cookie, não do `modo`/`view`
	});
});

describe('load de /impressoes — gravação do cookie', () => {
	it('grava a escolha da query no cookie certo', async () => {
		const { gravado } = await abrir('?ver=lista');
		expect(gravado).toHaveLength(1);
		expect(gravado[0].nome).toBe(COOKIE_VISUALIZACAO);
		expect(gravado[0].valor).toBe('lista');
	});

	it('grava com `secure: false` — em http de LAN, `secure` faria o cookie ser descartado', async () => {
		const { gravado } = await abrir('?ver=lista');
		expect(gravado[0].opcoes.secure).toBe(false);
	});

	it('grava para o site inteiro e por um ano', async () => {
		const { gravado } = await abrir('?ver=lista');
		expect(gravado[0].opcoes.path).toBe('/');
		expect(gravado[0].opcoes.maxAge).toBe(31_536_000);
	});

	it('grava fechado para script e sem viajar entre sites', async () => {
		const { gravado } = await abrir('?ver=lista');
		expect(gravado[0].opcoes.httpOnly).toBe(true);
		expect(gravado[0].opcoes.sameSite).toBe('lax');
	});

	it('não toca no cookie quando a visita não escolheu nada', async () => {
		expect((await abrir('')).gravado).toEqual([]);
		expect((await abrir('', 'lista')).gravado).toEqual([]);
	});

	it('não sobrescreve a preferência guardada por causa de query inválida', async () => {
		const { dados, gravado } = await abrir('?ver=tabela', 'lista');
		expect(dados.visualizacao).toBe('lista');
		expect(gravado).toEqual([]);
	});
});

describe('load de /impressoes — entrada hostil não derruba a tela', () => {
	const hostis = [
		'?ver=',
		'?ver=tabela',
		'?ver=' + encodeURIComponent('<script>alert(1)</script>'),
		'?ver=' + encodeURIComponent('../../etc/passwd'),
		'?ver=' + encodeURIComponent('grade\r\nSet-Cookie: x=1'),
		'?ver=' + encodeURIComponent('a'.repeat(4000)),
		'?ver=grade&ver=lista&ver=tabela',
		'?ver[]=grade',
		'?VER=lista'
	];

	for (const busca of hostis) {
		it(`responde com visualização válida e com a lista em "${busca}"`, async () => {
			const { dados, gravado } = await abrir(busca);
			expect(['grade', 'lista']).toContain(dados.visualizacao);
			// O que o `load` deve fazer é ENTREGAR A TELA: uma query estranha não
			// pode custar a lista de impressões.
			expect(dados.impressoes).toHaveLength(1);
			// Nada hostil chega ao cookie.
			for (const g of gravado) expect(['grade', 'lista']).toContain(g.valor);
		});
	}

	it('`?ver=grade&ver=lista` fica com o primeiro, sem lançar', async () => {
		const { dados } = await abrir('?ver=grade&ver=lista');
		expect(dados.visualizacao).toBe('grade');
	});
});
