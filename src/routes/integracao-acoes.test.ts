/**
 * Os contratos que só existem DEPOIS do merge das quatro frentes.
 *
 * Cada frente provou a sua metade sozinha, e cada metade passa em separado. O
 * que nenhuma delas podia provar é o que acontece quando as duas ocupam a mesma
 * action — e é justamente aí que a integração quebra em silêncio, porque o git
 * junta texto e não intenção.
 *
 * Três costuras estão aqui:
 *
 * 1. **token de envio (`crit-dados`) × eco do formulário (`crit-fluxo`).**
 *    Um erro de validação tem que devolver o digitado E deixar o token intacto.
 *    Se o token fosse gasto antes da validação, o reenvio corrigido — que é o
 *    gesto seguinte, garantido — seria recusado como "repetido", e o usuário
 *    veria "já registrado" sobre algo que nunca foi gravado.
 * 2. **pesagem em bruto (`crit-fluxo`) × trava de envio (`crit-dados`).**
 *    A `crit-fluxo` acrescentou DUAS escritas à ação de aferir (ajustar o peso
 *    inicial, abrir o rolo) que não existiam quando a trava foi desenhada em
 *    volta do insert da aferição. O toque duplo tem que cobrir as três.
 * 3. **pesagem final do encerramento (`encerrar`) × leitura de pesagem
 *    (`crit-fluxo`).** A `crit-fluxo` reescreveu como o formulário de pesagem é
 *    lido; o encerramento grava pesagem por outro caminho, e continua tendo que
 *    gravar.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'carretel-integra-')), 'teste.sqlite');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { CAMPO_ENVIO, esquecerEnvios, novoEnvio } = await import('$lib/server/envio');
const rolos = (await import('./rolos/+page.server')).actions;
const impressoes = (await import('./impressoes/+page.server')).actions;
const carregarImpressoes = (await import('./impressoes/+page.server')).load;

let impressoraId: number;
let roloId: number;

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
		.values({ nome: 'A1', modelo: 'Bambu Lab A1', precoCompraCents: 400_000 })
		.returning()
		.all();
	impressoraId = imp.id;

	const [rol] = db
		.insert(schema.rolo)
		.values({
			codigo: 'PLA-PRETO-01',
			marca: 'Bambu',
			material: 'PLA',
			cor: 'Preto',
			precoPagoCents: 12_000,
			pesoLiquidoInicialG: 1000,
			pesoCarretelG: 250,
			status: 'fechado'
		})
		.returning()
		.all();
	roloId = rol.id;
});

function evento(campos: Record<string, string>) {
	const corpo = new FormData();
	for (const [chave, valor] of Object.entries(campos)) corpo.set(chave, valor);
	return { request: new Request('http://localhost/', { method: 'POST', body: corpo }) } as never;
}

type Retorno = {
	status?: number;
	data?: { erro?: string; campo?: string; valores?: Record<string, string>; [k: string]: unknown };
	[k: string]: unknown;
};

/**
 * `redirect()` do SvelteKit é LANÇADO, não devolvido — e `?/encerrar` e
 * `?/reabrir` terminam em 303. Sem o `catch`, um teste de encerramento
 * confundiria o desfecho certo com uma exceção.
 */
async function chamar(
	action: (ev: never) => unknown,
	campos: Record<string, string>
): Promise<Retorno> {
	try {
		return (await action(evento(campos))) as Retorno;
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) {
			return e as Retorno;
		}
		throw e;
	}
}

const redirecionouPara = (r: Retorno, destino = '/rolos') =>
	r.status === 303 && r.location === destino;

const afericoes = () => db.select().from(schema.afericao).all();
const rolo = () => db.select().from(schema.rolo).where(eq(schema.rolo.id, roloId)).get()!;
const listaDeImpressoes = () => db.select().from(schema.impressao).all();

// ════════════════════════════════════════════════════════════════════════════
// 1. Erro de validação: devolve o digitado E devolve o token
// ════════════════════════════════════════════════════════════════════════════

describe('token de envio × eco do formulário — /rolos ?/aferir', () => {
	it('a recusa devolve o digitado, aponta o campo e NÃO queima o token', async () => {
		const envio = novoEnvio();

		// 200 g brutos não passam dos 250 g de carretel: recusa legítima.
		const ruim = await chamar(rolos.aferir, {
			roloId: String(roloId),
			pesoBrutoG: '200',
			[CAMPO_ENVIO]: envio
		});

		expect(ruim.status).toBe(400);
		expect(ruim.data?.valores?.pesoBrutoG).toBe('200');
		expect(ruim.data?.campo).toBe('pesoBrutoG');
		expect(afericoes()).toHaveLength(0);

		// O reenvio corrigido com o MESMO token — que é o que o navegador manda
		// quando a página não é recarregada — tem que gravar.
		const bom = await chamar(rolos.aferir, {
			roloId: String(roloId),
			pesoBrutoG: '812',
			[CAMPO_ENVIO]: envio
		});

		expect(bom.status).toBeUndefined();
		expect(bom.repetido).toBeUndefined();
		expect(afericoes()).toHaveLength(1);
		expect(afericoes()[0].pesoLiquidoG).toBe(562);
	});

	it('o reenvio com token novo (a página recarregou) também grava', async () => {
		// Sem JavaScript, o `fail` re-renderiza a página e o `load` desenha um
		// token novo no campo escondido. Os dois caminhos têm que funcionar.
		await chamar(rolos.aferir, {
			roloId: String(roloId),
			pesoBrutoG: '200',
			[CAMPO_ENVIO]: novoEnvio()
		});

		await chamar(rolos.aferir, {
			roloId: String(roloId),
			pesoBrutoG: '812',
			[CAMPO_ENVIO]: novoEnvio()
		});

		expect(afericoes()).toHaveLength(1);
	});

	it('o token só é gasto quando a pesagem entra: depois disso o toque duplo é UM registro', async () => {
		const envio = novoEnvio();
		const campos = { roloId: String(roloId), pesoBrutoG: '812', [CAMPO_ENVIO]: envio };

		await chamar(rolos.aferir, campos);
		const segunda = await chamar(rolos.aferir, campos);

		expect(afericoes()).toHaveLength(1);
		expect(segunda.repetido).toBe(true);
	});
});

describe('token de envio × eco do formulário — /impressoes ?/criar', () => {
	const impressao = (over: Record<string, string> = {}) => ({
		nomeLivre: 'MagicTray',
		impressoraId: String(impressoraId),
		roloId: String(roloId),
		duracao: '2h30',
		gramas: '47,7',
		status: 'sucesso',
		finalidade: 'homelab',
		...over
	});

	it('a recusa devolve os doze campos digitados e o token continua valendo', async () => {
		const envio = novoEnvio();

		const ruim = await chamar(
			impressoes.criar,
			impressao({ infillPct: '-3', [CAMPO_ENVIO]: envio })
		);

		expect(ruim.status).toBe(400);
		expect(ruim.data?.campo).toBe('infillPct');
		// O eco é o que impede o usuário de redigitar tudo por causa de um campo.
		expect(ruim.data?.valores?.nomeLivre).toBe('MagicTray');
		expect(ruim.data?.valores?.gramas).toBe('47,7');
		expect(ruim.data?.valores?.finalidade).toBe('homelab');
		expect(listaDeImpressoes()).toHaveLength(0);

		const bom = await chamar(
			impressoes.criar,
			impressao({ infillPct: '15', [CAMPO_ENVIO]: envio })
		);

		expect(bom.status).toBeUndefined();
		expect(bom.repetido).toBeUndefined();
		expect(listaDeImpressoes()).toHaveLength(1);
		// E a vírgula decimal do eco continua sendo lida como número.
		expect(listaDeImpressoes()[0].gramas).toBeCloseTo(47.7, 5);
	});

	it('depois de gravar, o mesmo token não grava a segunda', async () => {
		const envio = novoEnvio();
		await chamar(impressoes.criar, impressao({ [CAMPO_ENVIO]: envio }));
		const segunda = await chamar(impressoes.criar, impressao({ [CAMPO_ENVIO]: envio }));

		expect(listaDeImpressoes()).toHaveLength(1);
		expect(segunda.repetido).toBe(true);
	});
});

/**
 * A recusa que vem de DENTRO da função que escreve.
 *
 * O token é gasto imediatamente antes da escrita, e isso pressupõe que tudo
 * que pode recusar já rodou. Não é o caso quando a regra mora no repositório:
 * `encerrarRolo` recusa sobra maior que o rolo e `criarRolo` recusa código já
 * em uso, os dois DEPOIS do token. Sem devolvê-lo, corrigir e reenviar o mesmo
 * formulário responderia "já enviado" sobre algo que nunca foi gravado — o
 * caso reachable está em "encerramento recusado não queima o token", acima.
 *
 * O que este bloco trava é o contrário: que devolver o token não afrouxou a
 * trava que ele existe para ser.
 */
describe('devolver o token não afrouxa a trava', () => {
	const cadastro = (over: Record<string, string> = {}) => ({
		marca: 'Bambu',
		material: 'PLA',
		cor: 'Preto',
		densidade: '1,24',
		preco: '129,90',
		pesoInicial: '1000',
		pesoCarretel: '250',
		...over
	});

	const listaDeRolos = () => db.select().from(schema.rolo).all();

	it('devolver o token não afrouxa a trava: o toque duplo continua sendo um rolo', async () => {
		const envio = novoEnvio();
		await chamar(rolos.criar, cadastro({ cor: 'Branco', [CAMPO_ENVIO]: envio }));
		const segunda = await chamar(rolos.criar, cadastro({ cor: 'Branco', [CAMPO_ENVIO]: envio }));

		expect(listaDeRolos()).toHaveLength(2); // o do beforeEach + um
		expect(segunda.repetido).toBe(true);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// 2. As escritas que a `crit-fluxo` acrescentou ao aferir entram na trava
// ════════════════════════════════════════════════════════════════════════════

describe('a trava de envio cobre as escritas novas do aferir', () => {
	// As duas escritas que a `crit-fluxo` trouxe são idempotentes por sorte, não
	// por desenho — o segundo toque relê o rolo e não acha mais o que mudar. O
	// que estes testes travam é o resultado observável: um toque duplo não pode
	// deixar rastro nenhum além da aferição única. O `registrarEnvio` foi movido
	// para antes das duas por contrato (`envio.ts`: "imediatamente antes da
	// escrita"), e não porque a ordem antiga corrompesse algo.

	it('o toque duplo não abre o rolo duas vezes nem grava duas aferições', async () => {
		const envio = novoEnvio();
		const campos = { roloId: String(roloId), pesoBrutoG: '812', [CAMPO_ENVIO]: envio };

		expect(rolo().status).toBe('fechado');

		await chamar(rolos.aferir, campos);
		const abertoEm = rolo().dataAbertura?.getTime();
		const segunda = await chamar(rolos.aferir, campos);

		expect(segunda.repetido).toBe(true);
		expect(afericoes()).toHaveLength(1);
		expect(rolo().status).toBe('aberto');
		// A data de abertura é a da PRIMEIRA pesagem: o segundo toque não pode
		// reescrevê-la, porque é ela que liga o alerta de umidade.
		expect(rolo().dataAbertura?.getTime()).toBe(abertoEm);
	});

	it('o toque duplo com ajuste do peso inicial não sobe o cadastro duas vezes', async () => {
		const envio = novoEnvio();
		const campos = {
			roloId: String(roloId),
			pesoLiquidoG: '1024',
			ajustarInicial: 'on',
			[CAMPO_ENVIO]: envio
		};

		await chamar(rolos.aferir, campos);
		await chamar(rolos.aferir, campos);

		expect(rolo().pesoLiquidoInicialG).toBe(1024);
		expect(afericoes()).toHaveLength(1);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Filtrar (`crit-leitura`) e então reclassificar o recorte (`crit-fluxo`)
// ════════════════════════════════════════════════════════════════════════════

/**
 * As duas frentes reescreveram a MESMA tela sem se ver: a `crit-leitura`
 * paginou a lista em 50, e a `crit-fluxo` pôs no pé dela um botão que aplica a
 * finalidade "a todas as listadas", lendo ids que o servidor desenhou.
 *
 * Juntas e sem ajuste, o cabeçalho diria "60 impressões" e o botão
 * reclassificaria 50 — e as 10 restantes ficariam para uma segunda viagem, sem
 * ninguém avisar. O escopo do lote passou a ser o RECORTE, que é a unidade que
 * o subtotal já contava.
 */
describe('o lote reclassifica o recorte, e não a página', () => {
	const cookies = {
		get: () => undefined,
		set: () => {},
		delete: () => {},
		getAll: () => [],
		serialize: () => ''
	} as never;

	const abrir = (busca: string) =>
		carregarImpressoes({
			url: new URL(`http://localhost/impressoes${busca}`),
			cookies
		} as never) as Promise<{
			impressoes: { id: number }[];
			idsDoRecorte: number[];
			total: { impressoes: number };
			pagina: { totalPaginas: number };
		}>;

	const semear = (quantas: number, finalidade: 'outro' | 'estudio') => {
		for (let n = 0; n < quantas; n++) {
			db.insert(schema.impressao)
				.values({
					nomeLivre: `${finalidade}-${n}`,
					impressoraId,
					roloId,
					inicioEm: new Date(1_754_700_000_000 + n * 60_000),
					duracaoS: 3600,
					gramas: 10,
					status: 'sucesso',
					finalidade,
					origem: 'nuvem'
				})
				.run();
		}
	};

	it('os ids desenhados cobrem o recorte inteiro, mesmo com mais de uma página', async () => {
		semear(60, 'outro');
		semear(60, 'estudio');

		const tela = await abrir('?finalidade=outro');

		expect(tela.total.impressoes).toBe(60);
		expect(tela.pagina.totalPaginas).toBe(2);
		// A página mostra 50; o lote alcança as 60 que o subtotal contou.
		expect(tela.impressoes).toHaveLength(50);
		expect(tela.idsDoRecorte).toHaveLength(60);
	});

	it('reclassificar o recorte filtrado alcança as 60 e não encosta nas outras', async () => {
		semear(60, 'outro');
		semear(60, 'estudio');

		const tela = await abrir('?finalidade=outro');

		const corpo = new FormData();
		corpo.set('finalidadeLote', 'homelab');
		corpo.set('escopo', 'todas');
		for (const id of tela.idsDoRecorte) corpo.append('listada', String(id));

		const r = (await impressoes.finalidadeEmLote({
			request: new Request('http://localhost/', { method: 'POST', body: corpo })
		} as never)) as { sucessoLote?: number };

		expect(r.sucessoLote).toBe(60);

		const porFinalidade = (f: string) =>
			db.select().from(schema.impressao).all().filter((i) => i.finalidade === f).length;

		expect(porFinalidade('homelab')).toBe(60);
		expect(porFinalidade('estudio')).toBe(60);
		expect(porFinalidade('outro')).toBe(0);
	});

	it('a busca também recorta o lote: só as peças que casam mudam de balde', async () => {
		semear(3, 'outro');
		db.insert(schema.impressao)
			.values({
				nomeLivre: 'Peça de conteúdo',
				impressoraId,
				roloId,
				inicioEm: new Date(1_754_700_000_000),
				duracaoS: 3600,
				gramas: 10,
				status: 'sucesso',
				finalidade: 'outro',
				origem: 'manual'
			})
			.run();

		// Sem acento e em caixa baixa: a busca dobra os dois.
		const tela = await abrir('?q=peca');
		expect(tela.idsDoRecorte).toHaveLength(1);

		const corpo = new FormData();
		corpo.set('finalidadeLote', 'conteudo');
		corpo.set('escopo', 'todas');
		for (const id of tela.idsDoRecorte) corpo.append('listada', String(id));
		await impressoes.finalidadeEmLote({
			request: new Request('http://localhost/', { method: 'POST', body: corpo })
		} as never);

		const linhas = db.select().from(schema.impressao).all();
		expect(linhas.filter((i) => i.finalidade === 'conteudo')).toHaveLength(1);
		expect(linhas.filter((i) => i.finalidade === 'outro')).toHaveLength(3);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Encerrar com pesagem, depois da reescrita da pesagem pela `crit-fluxo`
// ════════════════════════════════════════════════════════════════════════════

/**
 * A `encerrar` grava a pesagem final como `afericao`; a `crit-fluxo` reescreveu
 * como a pesagem AVULSA é lida (dois campos, conversão do bruto, observação
 * dizendo a origem). Os dois caminhos gravam na mesma tabela e disputam a mesma
 * âncora de estoque, então o que precisa ser provado aqui é que continuam
 * sendo dois caminhos e não um.
 */
describe('encerrar com pesagem × a pesagem em bruto', () => {
	const encerrar = (campos: Record<string, string>) =>
		chamar(rolos.encerrar, { id: String(roloId), confirmar: '1', ...campos });

	const pesagens = () => afericoes().map((a) => ({ g: a.pesoLiquidoG, obs: a.observacao }));

	it('a pesagem final entra como aferição própria, e não como pesagem manual', async () => {
		// Antes: uma pesagem avulsa, pelo caminho novo da `crit-fluxo` (bruto).
		await chamar(rolos.aferir, { roloId: String(roloId), pesoBrutoG: '812' });

		const r = await encerrar({ motivo: 'sobra', sobra: '540' });
		expect(redirecionouPara(r)).toBe(true);

		expect(pesagens()).toEqual([
			{ g: 562, obs: 'pesagem manual · 812 g brutos − 250 g de carretel' },
			{ g: 540, obs: 'pesagem final' }
		]);
		expect(rolo().status).toBe('descartado');
	});

	it('encerrar como "acabou" aceita zero, que a pesagem avulsa continua recusando', async () => {
		await encerrar({ motivo: 'acabou', sobra: '0' });

		expect(pesagens()).toEqual([{ g: 0, obs: 'pesagem final' }]);
		expect(rolo().status).toBe('vazio');

		// A mesma balança marcando 0 g no campo avulso continua sendo erro: lá,
		// zero é sintoma de campo em branco.
		const avulsa = await chamar(rolos.aferir, { roloId: String(roloId), pesoLiquidoG: '0' });
		expect(avulsa.status).toBe(400);
	});

	it('encerrar sem pesar não inventa aferição nenhuma', async () => {
		await encerrar({ motivo: 'sobra', sobra: '' });
		expect(afericoes()).toHaveLength(0);
		expect(rolo().status).toBe('descartado');
	});

	it('a sobra final também aceita vírgula decimal, como todo campo numérico', async () => {
		await encerrar({ motivo: 'sobra', sobra: '6,4' });
		expect(afericoes()[0].pesoLiquidoG).toBeCloseTo(6.4, 5);
	});

	it('reabrir preserva a pesagem final e devolve o rolo ao estado anterior', async () => {
		await chamar(rolos.aferir, { roloId: String(roloId), pesoBrutoG: '812' });
		await encerrar({ motivo: 'sobra', sobra: '540' });

		const r = await chamar(rolos.reabrir, { id: String(roloId), confirmar: '1' });
		expect(redirecionouPara(r)).toBe(true);

		// Pesar abriu o rolo (`crit-fluxo`), então a volta é para `aberto`.
		expect(rolo().status).toBe('aberto');
		expect(afericoes()).toHaveLength(2);
	});
});

describe('a trava de envio alcança o encerramento', () => {
	it('dois toques em "Encerrar o filamento" deixam UMA pesagem final', async () => {
		const envio = novoEnvio();
		const campos = {
			id: String(roloId),
			confirmar: '1',
			motivo: 'sobra',
			sobra: '540',
			[CAMPO_ENVIO]: envio
		};

		await chamar(rolos.encerrar, campos);
		await chamar(rolos.encerrar, campos);

		expect(afericoes()).toHaveLength(1);
		expect(rolo().status).toBe('descartado');
	});

	it('encerramento recusado não queima o token', async () => {
		const envio = novoEnvio();

		// Sobra maior que o rolo: recusa legítima, e nada gravado.
		const ruim = await chamar(rolos.encerrar, {
			id: String(roloId),
			confirmar: '1',
			motivo: 'sobra',
			sobra: '5000',
			[CAMPO_ENVIO]: envio
		});
		expect(ruim.status).toBe(400);
		expect(afericoes()).toHaveLength(0);
		expect(rolo().status).toBe('fechado');

		await chamar(rolos.encerrar, {
			id: String(roloId),
			confirmar: '1',
			motivo: 'sobra',
			sobra: '540',
			[CAMPO_ENVIO]: envio
		});

		expect(afericoes()).toHaveLength(1);
		expect(rolo().status).toBe('descartado');
	});
});

// ════════════════════════════════════════════════════════════════════════════
// 5. A vírgula decimal, ponta a ponta
// ════════════════════════════════════════════════════════════════════════════

/**
 * A correção que só existe na integração: os helpers aceitam vírgula desde
 * `d77dbbc`, mas os campos eram `<input type="number">` — que **recusa a
 * vírgula na digitação**. Os campos decimais viraram `type="text"` com
 * `inputmode="decimal"` (ver `Entrada.svelte`), e é isso que faz a vírgula
 * chegar até aqui em vez de ser barrada no navegador.
 *
 * O teste é do SERVIDOR porque é a metade que dá para provar sem navegador: se
 * um destes campos voltar a recusar vírgula, o campo passa a mentir para quem
 * digita `1,27`. A outra metade (o `type` do HTML) está travada pela conferência
 * no navegador e pelo comentário de `Entrada.svelte`.
 */
describe('todo campo decimal aceita vírgula', () => {
	const listaDeRolos = () => db.select().from(schema.rolo).all();

	it('cadastro de rolo: densidade, peso inicial e peso do carretel', async () => {
		const r = await chamar(rolos.criar, {
			marca: 'Bambu',
			material: 'PETG',
			cor: 'Branco',
			densidade: '1,27',
			preco: '129,90',
			pesoInicial: '1010,5',
			pesoCarretel: '212,3'
		});

		expect(r.status).toBeUndefined();
		const novo = listaDeRolos().find((x) => x.material === 'PETG')!;
		expect(novo.densidade).toBeCloseTo(1.27, 5);
		expect(novo.pesoLiquidoInicialG).toBeCloseTo(1010.5, 5);
		expect(novo.pesoCarretelG).toBeCloseTo(212.3, 5);
		expect(novo.precoPagoCents).toBe(12_990);
	});

	it('pesagem: os dois campos, bruto e líquido', async () => {
		const bruta = await chamar(rolos.aferir, { roloId: String(roloId), pesoBrutoG: '812,5' });
		expect(bruta.status).toBeUndefined();
		expect(afericoes()[0].pesoLiquidoG).toBeCloseTo(562.5, 5);

		const liquida = await chamar(rolos.aferir, { roloId: String(roloId), pesoLiquidoG: '480,2' });
		expect(liquida.status).toBeUndefined();
		expect(afericoes()[1].pesoLiquidoG).toBeCloseTo(480.2, 5);
	});

	it('impressão: gramas e altura de camada', async () => {
		const r = await chamar(impressoes.criar, {
			nomeLivre: 'MagicTray',
			impressoraId: String(impressoraId),
			roloId: String(roloId),
			duracao: '2h30',
			gramas: '47,7',
			camadaMm: '0,16',
			status: 'sucesso',
			finalidade: 'homelab'
		});

		expect(r.status).toBeUndefined();
		expect(listaDeImpressoes()[0].gramas).toBeCloseTo(47.7, 5);
		expect(listaDeImpressoes()[0].camadaMm).toBeCloseTo(0.16, 5);
	});

	it('encerramento: a sobra final', async () => {
		await chamar(rolos.encerrar, {
			id: String(roloId),
			confirmar: '1',
			motivo: 'sobra',
			sobra: '6,4'
		});
		expect(afericoes()[0].pesoLiquidoG).toBeCloseTo(6.4, 5);
	});
});
