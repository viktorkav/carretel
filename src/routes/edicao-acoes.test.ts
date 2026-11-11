/**
 * Testes das ACTIONS de edição, e não só dos helpers.
 *
 * O motivo é específico: a falha que estes testes travam não estava em nenhum
 * helper — estava na FIAÇÃO. As actions de edição chamavam os helpers de
 * criação, que tratam campo em branco como "não preencheu, usa o padrão". Num
 * cadastro novo isso é certo; numa edição, onde o formulário volta preenchido,
 * limpar um campo é um clique e o padrão entra por cima do valor guardado, com
 * HTTP 200 e mensagem "salva". Um teste de helper passaria feliz.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

// O módulo de banco resolve o arquivo na carga, então o caminho precisa estar
// no ambiente ANTES do import.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'carretel-acoes-')), 'teste.sqlite');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { registrarImpressao } = await import('$lib/server/repo');
const impressoras = (await import('./impressoras/+page.server')).actions;
const rolos = (await import('./rolos/+page.server')).actions;
const impressoesId = (await import('./impressoes/[id]/+page.server')).actions;

const INICIO = 1_754_700_000_000;
const FIM = 1_754_703_600_000;

let ids: { impressoraId: number; roloId: number; impressaoId: number };

beforeEach(() => {
	db.delete(schema.impressao).run();
	db.delete(schema.afericao).run();
	db.delete(schema.manutencao).run();
	db.delete(schema.rolo).run();
	db.delete(schema.impressora).run();
	db.delete(schema.config).run();
	db.insert(schema.config).values({ id: 1, tarifaKwhCents: 95 }).run();

	const [imp] = db
		.insert(schema.impressora)
		.values({
			nome: 'A1',
			modelo: 'Bambu Lab A1',
			precoCompraCents: 400000,
			vidaUtilHoras: 8000,
			potenciaMediaW: 150
		})
		.returning()
		.all();
	const [rol] = db
		.insert(schema.rolo)
		.values({
			codigo: 'PLA-PRETO-01',
			marca: 'Bambu',
			material: 'PLA',
			cor: 'Preto',
			densidade: 1.31,
			tempBico: 220,
			precoPagoCents: 12000,
			pesoLiquidoInicialG: 750,
			pesoCarretelG: 180,
			status: 'aberto'
		})
		.returning()
		.all();
	const impressao = registrarImpressao(db, {
		nomeLivre: 'caixa',
		impressoraId: imp.id,
		roloId: rol.id,
		inicioEm: INICIO,
		fimEm: FIM,
		duracaoS: 3600,
		gramas: 100,
		status: 'sucesso',
		finalidade: 'estudio',
		origem: 'nuvem'
	});

	ids = {
		impressoraId: imp.id,
		roloId: rol.id,
		impressaoId: impressao.id
	};
});

/** RequestEvent mínimo: as actions daqui só usam `request` e `params`. */
function evento(campos: Record<string, string>, params: Record<string, string> = {}) {
	const corpo = new FormData();
	for (const [chave, valor] of Object.entries(campos)) corpo.set(chave, valor);
	return {
		request: new Request('http://localhost/', { method: 'POST', body: corpo }),
		params
	} as never;
}

type Retorno = { status?: number; data?: { erro?: string }; [k: string]: unknown };

async function chamar(
	action: (ev: never) => unknown,
	campos: Record<string, string>,
	params: Record<string, string> = {}
): Promise<Retorno> {
	try {
		return (await action(evento(campos, params))) as Retorno;
	} catch (e) {
		// `redirect()` sobe como objeto, não como erro de verdade.
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) {
			return { redirecionou: true, ...(e as object) };
		}
		throw e;
	}
}

function recusou(r: Retorno) {
	return r.status === 400 && typeof r.data?.erro === 'string' && r.data.erro.length > 0;
}

const lerImpressora = () =>
	db.select().from(schema.impressora).where(eq(schema.impressora.id, ids.impressoraId)).get()!;
const lerRolo = () => db.select().from(schema.rolo).where(eq(schema.rolo.id, ids.roloId)).get()!;
const lerImpressao = () =>
	db.select().from(schema.impressao).where(eq(schema.impressao.id, ids.impressaoId)).get()!;

// ── campo em branco na edição ───────────────────────────────────────────────

describe('/impressoras ?/editar', () => {
	const base = { id: '', nome: 'A1', modelo: 'Bambu Lab A1' };

	// UM caso por campo, e não um POST com os três vazios: com os três juntos,
	// qualquer um dos outros dois recusa a request e o teste passa mesmo que o
	// campo sob suspeita tenha voltado a cair no padrão. Foi assim que duas
	// mutações sobreviveram na primeira rodada.
	const cheios = () => ({
		...base,
		id: String(ids.impressoraId),
		preco: '4000,00',
		vidaUtilHoras: '8000',
		potenciaMediaW: '150'
	});

	it('recusa PREÇO em branco em vez de gravar zero por cima', async () => {
		const r = await chamar(impressoras.editar, { ...cheios(), preco: '' });
		expect(recusou(r)).toBe(true);
		expect(lerImpressora().precoCompraCents).toBe(400000);
	});

	it('recusa VIDA ÚTIL em branco em vez de gravar o padrão de 5000 h', async () => {
		const r = await chamar(impressoras.editar, { ...cheios(), vidaUtilHoras: '' });
		expect(recusou(r)).toBe(true);
		expect(lerImpressora().vidaUtilHoras).toBe(8000);
	});

	it('recusa POTÊNCIA em branco em vez de gravar o padrão de 100 W', async () => {
		const r = await chamar(impressoras.editar, { ...cheios(), potenciaMediaW: '' });
		expect(recusou(r)).toBe(true);
		expect(lerImpressora().potenciaMediaW).toBe(150);
	});

	it('recusa vida útil com letra no lugar do zero ("8OOO")', async () => {
		const r = await chamar(impressoras.editar, {
			...base,
			id: String(ids.impressoraId),
			preco: '4000,00',
			vidaUtilHoras: '8OOO',
			potenciaMediaW: '150'
		});
		expect(recusou(r)).toBe(true);
		expect(lerImpressora().vidaUtilHoras).toBe(8000);
	});

	it('recusa 1e999 em vez de gravar Infinity', async () => {
		const r = await chamar(impressoras.editar, {
			...base,
			id: String(ids.impressoraId),
			preco: '1e999',
			vidaUtilHoras: '8000',
			potenciaMediaW: '150'
		});
		expect(recusou(r)).toBe(true);
		expect(Number.isFinite(lerImpressora().precoCompraCents)).toBe(true);
		expect(lerImpressora().precoCompraCents).toBe(400000);
	});

	it('aceita 0,00 como "preço não informado" digitado de propósito', async () => {
		const r = await chamar(impressoras.editar, {
			...base,
			id: String(ids.impressoraId),
			preco: '0,00',
			vidaUtilHoras: '8000',
			potenciaMediaW: '150'
		});
		expect(r.status).toBeUndefined();
		expect(lerImpressora().precoCompraCents).toBe(0);
	});

	it('salva normalmente quando os campos vêm preenchidos', async () => {
		const r = await chamar(impressoras.editar, {
			...base,
			id: String(ids.impressoraId),
			nome: 'A1 mini',
			preco: '5000,00',
			vidaUtilHoras: '9000',
			potenciaMediaW: '160',
			ativa: 'on'
		});
		expect(r.status).toBeUndefined();

		const lida = lerImpressora();
		expect(lida.nome).toBe('A1 mini');
		expect(lida.precoCompraCents).toBe(500000);
		expect(lida.vidaUtilHoras).toBe(9000);
		expect(lida.potenciaMediaW).toBe(160);
	});
});

describe('/impressoras ?/criar', () => {
	// A semântica de CRIAÇÃO não muda: lá o branco é "não preenchi", e o padrão
	// documentado no formulário é a resposta certa.
	it('continua aceitando campos em branco e usando os padrões', async () => {
		const r = await chamar(impressoras.criar, { nome: 'P1S', modelo: 'P1S' });
		expect(r.status).toBeUndefined();

		const nova = db.select().from(schema.impressora).all().at(-1)!;
		expect(nova.vidaUtilHoras).toBe(5000);
		expect(nova.potenciaMediaW).toBe(100);
		expect(nova.precoCompraCents).toBe(0);
	});
});

describe('/rolos ?/editar', () => {
	// A ficha do filamento (marca/material/cor/densidade) passou a ser do rolo,
	// então ela vem em TODO POST de edição — em branco, ela é recusada.
	const base = () => ({
		id: String(ids.roloId),
		codigo: 'PLA-PRETO-01',
		marca: 'Bambu',
		material: 'PLA',
		cor: 'Preto',
		densidade: '1.31',
		status: 'aberto'
	});

	// Um caso por campo, pelo mesmo motivo de /impressoras.
	const cheios = () => ({ ...base(), preco: '120,00', pesoInicial: '750', pesoCarretel: '180' });

	it('recusa PREÇO em branco em vez de gravar zero por cima', async () => {
		const r = await chamar(rolos.editar, { ...cheios(), preco: '' });
		expect(recusou(r)).toBe(true);
		expect(lerRolo().precoPagoCents).toBe(12000);
	});

	it('recusa PESO INICIAL em branco em vez de gravar o padrão de 1000 g', async () => {
		const r = await chamar(rolos.editar, { ...cheios(), pesoInicial: '' });
		expect(recusou(r)).toBe(true);
		expect(lerRolo().pesoLiquidoInicialG).toBe(750);
	});

	it('recusa PESO DO CARRETEL em branco em vez de gravar o padrão de 250 g', async () => {
		const r = await chamar(rolos.editar, { ...cheios(), pesoCarretel: '' });
		expect(recusou(r)).toBe(true);
		expect(lerRolo().pesoCarretelG).toBe(180);
	});

	it('recusa peso inicial infinito, que desarmaria a trava contra a pesagem', async () => {
		db.insert(schema.afericao).values({ roloId: ids.roloId, pesoLiquidoG: 700 }).run();

		const r = await chamar(rolos.editar, {
			...base(),
			preco: '120,00',
			pesoInicial: '1e999',
			pesoCarretel: '180'
		});
		expect(recusou(r)).toBe(true);
		expect(lerRolo().pesoLiquidoInicialG).toBe(750);
	});

	it('salva normalmente quando os campos vêm preenchidos', async () => {
		const r = await chamar(rolos.editar, {
			...base(),
			preco: '60,00',
			pesoInicial: '1000',
			pesoCarretel: '250',
			fornecedor: 'Loja X'
		});
		expect(r.status).toBeUndefined();

		const lido = lerRolo();
		expect(lido.precoPagoCents).toBe(6000);
		expect(lido.pesoLiquidoInicialG).toBe(1000);
		expect(lido.fornecedor).toBe('Loja X');
	});
});

/**
 * Estes quatro vinham de `/filamentos ?/editar`, que não existe mais: a ficha
 * do filamento é do rolo agora. A regra que eles travam continua sendo a mesma
 * — campo em branco na EDIÇÃO não pode cair no padrão de cadastro —, e ela
 * precisa continuar valendo depois de a ficha mudar de dono.
 */
describe('/rolos ?/editar · a ficha que veio do filamento', () => {
	const cheios = () => ({
		id: String(ids.roloId),
		codigo: 'PLA-PRETO-01',
		marca: 'Bambu',
		material: 'PLA',
		cor: 'Preto',
		densidade: '1.31',
		status: 'aberto',
		preco: '120,00',
		pesoInicial: '750',
		pesoCarretel: '180'
	});

	it('recusa densidade em branco em vez de gravar 1,24 por cima', async () => {
		const r = await chamar(rolos.editar, { ...cheios(), densidade: '' });
		expect(recusou(r)).toBe(true);
		expect(lerRolo().densidade).toBeCloseTo(1.31);
	});

	it('recusa densidade infinita', async () => {
		const r = await chamar(rolos.editar, { ...cheios(), densidade: '1e999' });
		expect(recusou(r)).toBe(true);
		expect(lerRolo().densidade).toBeCloseTo(1.31);
	});

	it('recusa temperatura com lixo em vez de apagá-la em silêncio', async () => {
		const r = await chamar(rolos.editar, { ...cheios(), tempBico: 'abc' });
		expect(recusou(r)).toBe(true);
		expect(lerRolo().tempBico).toBe(220);
	});

	it('aceita temperatura em branco como "não informada"', async () => {
		const r = await chamar(rolos.editar, { ...cheios(), tempBico: '', tempMesa: '' });
		expect(r.status).toBeUndefined();
		expect(lerRolo().tempBico).toBe(null);
	});

	it('recusa marca em branco — ela é obrigatória como sempre foi', async () => {
		const r = await chamar(rolos.editar, { ...cheios(), marca: '' });
		expect(recusou(r)).toBe(true);
		expect(lerRolo().marca).toBe('Bambu');
	});

	it('recusa hex inválido em vez de apagar a cor boa', async () => {
		db.update(schema.rolo)
			.set({ corHex: '#000000' })
			.where(eq(schema.rolo.id, ids.roloId))
			.run();

		const r = await chamar(rolos.editar, { ...cheios(), corHex: '#zzz' });
		expect(recusou(r)).toBe(true);
		expect(lerRolo().corHex).toBe('#000000');
	});
});

describe('/impressoes/[id] ?/editar', () => {
	const base = () => ({
		nomeLivre: 'caixa',
		impressoraId: String(ids.impressoraId),
		roloId: String(ids.roloId),
		gramas: '100',
		status: 'sucesso',
		finalidade: 'estudio',
		inicioEm: '2026-08-09T00:00',
		duracao: '1,00h'
	});
	const params = () => ({ id: String(ids.impressaoId) });

	it('recusa duração em branco — ela zeraria energia, depreciação e o horímetro', async () => {
		const r = await chamar(
			impressoesId.editar,
			{ ...base(), duracao: '', recalcular: 'on' },
			params()
		);
		expect(recusou(r)).toBe(true);

		const lida = lerImpressao();
		expect(lida.duracaoS).toBe(3600);
		expect(lida.custoTotalCents).toBeGreaterThan(1600);
	});

	it('recusa duração malformada ("1:75") em vez de virar zero', async () => {
		const r = await chamar(
			impressoesId.editar,
			{ ...base(), duracao: '1:75', recalcular: 'on' },
			params()
		);
		expect(recusou(r)).toBe(true);
		expect(lerImpressao().duracaoS).toBe(3600);
	});

	it('recusa início em branco — a impressão saltaria para "agora"', async () => {
		const r = await chamar(impressoesId.editar, { ...base(), inicioEm: '' }, params());
		expect(recusou(r)).toBe(true);
		expect(lerImpressao().inicioEm.getTime()).toBe(INICIO);
	});

	it('recusa camada com lixo em vez de apagá-la', async () => {
		db.update(schema.impressao)
			.set({ camadaMm: 0.2 })
			.where(eq(schema.impressao.id, ids.impressaoId))
			.run();

		const r = await chamar(impressoesId.editar, { ...base(), camadaMm: 'abc' }, params());
		expect(recusou(r)).toBe(true);
		expect(lerImpressao().camadaMm).toBeCloseTo(0.2);
	});

	it('preserva o horário de término, que a tela não envia', async () => {
		expect(lerImpressao().fimEm?.getTime()).toBe(FIM);

		const r = await chamar(impressoesId.editar, { ...base(), gramas: '40' }, params());
		expect(r.status).toBeUndefined();

		const lida = lerImpressao();
		expect(lida.gramas).toBe(40);
		expect(lida.fimEm?.getTime()).toBe(FIM);
	});

	it('salva normalmente quando os campos vêm preenchidos', async () => {
		const r = await chamar(
			impressoesId.editar,
			{ ...base(), gramas: '40', duracao: '2,00h', recalcular: 'on' },
			params()
		);
		expect(r.status).toBeUndefined();

		const lida = lerImpressao();
		expect(lida.gramas).toBe(40);
		expect(lida.duracaoS).toBe(7200);
		// 40 g × 16 c/g = 640; energia 2 h × 0,15 kW × 95 = 28,5 → 29;
		// depreciação 2 h × (400000/8000) = 100.
		expect(lida.custoFilamentoCents).toBe(640);
		expect(lida.custoEnergiaCents).toBe(29);
		expect(lida.custoDepreciacaoCents).toBe(100);
	});
});
