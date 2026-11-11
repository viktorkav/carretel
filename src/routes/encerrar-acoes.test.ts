/**
 * Testes das ACTIONS de encerramento de rolo — não dos helpers.
 *
 * O pedido do dono foi uma frase: *"faltou um botão pra dar o rolo como
 * finalizado… imprimi o teste e sobrou muito pouco, não acho que eu ainda vá
 * usar pra algo"*. Duas coisas diferentes moram nela — o filamento ACABAR e o
 * dono ENCERRAR um rolo que ainda tem material —, e as duas viram estados que
 * o resto do sistema já sabe recusar (`vazio` e `descartado`).
 *
 * O que só um teste de action pega: a fiação. O mapeamento motivo → status, a
 * ordem entre calcular a sobra estimada e gravar a pesagem final (invertida,
 * a comparação vira tautologia), e o fato de a pesagem final continuar de pé
 * quando o rolo é reaberto.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

const pasta = mkdtempSync(join(tmpdir(), 'carretel-encerrar-'));
process.env.DATABASE_PATH = join(pasta, 'teste.sqlite');

const CATALOGO = join(pasta, 'catalogo.json');
writeFileSync(
	CATALOGO,
	JSON.stringify({
		fonte: 'teste',
		licencaFonte: 'AGPL-3.0',
		commit: 'a'.repeat(40),
		geradoEm: '2026-08-10',
		itens: []
	})
);
process.env.CATALOGO_PATH = CATALOGO;

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { estoqueDoRolo, registrarImpressao } = await import('$lib/server/repo');
const rolosRota = await import('./rolos/+page.server');
const rolos = rolosRota.actions;
const impressoes = await import('./impressoes/+page.server');
const impressoesId = await import('./impressoes/[id]/+page.server');

const INICIO = 1_754_700_000_000;

let impressoraId: number;
let roloId: number;

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
	impressoraId = imp.id;

	// O rolo do pedido: a amostra de 20 g que vem com a A1, aberta e usada.
	const [rol] = db
		.insert(schema.rolo)
		.values({
			codigo: 'PLA-BRANCO-01',
			marca: 'Bambu Lab',
			material: 'PLA Basic',
			cor: 'Branco',
			codigoBambu: 'GFA00',
			precoPagoCents: 0,
			pesoLiquidoInicialG: 20,
			pesoCarretelG: 10,
			status: 'aberto',
			dataAbertura: new Date(INICIO)
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

type Retorno = { status?: number; data?: { erro?: string }; [k: string]: unknown };

async function chamar(
	action: (ev: never) => unknown,
	campos: Record<string, string>
): Promise<Retorno> {
	try {
		return (await action(evento(campos))) as Retorno;
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && 'location' in e) {
			return { redirecionou: true, ...(e as object) };
		}
		throw e;
	}
}

function recusou(r: Retorno) {
	return r.status === 400 && typeof r.data?.erro === 'string' && r.data.erro.length > 0;
}

/**
 * Encerrar e reabrir terminam em 303 para `/rolos`, como excluir e apagar
 * pesagem. Não é detalhe de protocolo: o passo é revelado por `?encerrar=<id>`,
 * e responder 200 deixaria a query string de pé — recarregar a página reabriria
 * a confirmação de um encerramento que já aconteceu.
 */
function redirecionouPara(r: Retorno, destino = '/rolos') {
	return r.status === 303 && r.location === destino;
}

const ler = (id = roloId) => db.select().from(schema.rolo).where(eq(schema.rolo.id, id)).get()!;

const pesagens = (id = roloId) =>
	db.select().from(schema.afericao).where(eq(schema.afericao.roloId, id)).all();

/** O `load` de /rolos lê só `url`. */
async function carregar(busca = '') {
	return (await rolosRota.load({
		url: new URL(`http://localhost/rolos${busca}`)
	} as never)) as {
		ativos: { id: number; codigo: string }[];
		encerrados: {
			id: number;
			codigo: string;
			alertas: unknown[];
			estoque: { restanteG: number };
			rendimento:
				| {
						ok: true;
						rendimento: {
							estimadaG: number;
							realG: number;
							diferencaG: number;
							sentido: string;
							relevante: boolean;
						};
				  }
				| { ok: false; motivo: string };
		}[];
		encerrando: { id: number; sobraEstimadaG: number } | null;
		reabrindo: { id: number; pesagemFinal: { pesoLiquidoG: number } | null } | null;
	};
}

function ctxImpressoes() {
	return {
		url: new URL('http://localhost/impressoes'),
		cookies: { get: () => undefined, set: () => {} }
	};
}

/** Consome 12 g dos 20 g do rolo — sobra estimada de 8 g. */
function imprimir(gramas = 12) {
	return registrarImpressao(db, {
		nomeLivre: 'teste da A1',
		impressoraId,
		roloId,
		inicioEm: INICIO,
		duracaoS: 3600,
		gramas,
		status: 'sucesso',
		finalidade: 'estudio',
		origem: 'manual'
	});
}

// ── as duas situações ───────────────────────────────────────────────────────

describe('/rolos ?/encerrar · acabou × encerrado com sobra', () => {
	it('“acabou” marca o rolo como vazio', async () => {
		imprimir();
		const r = await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'acabou',
			confirmar: '1'
		});
		expect(redirecionouPara(r)).toBe(true);
		expect(ler().status).toBe('vazio');
	});

	it('“sobra” marca o rolo como descartado — ainda tem material, mas saiu de circulação', async () => {
		imprimir();
		const r = await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			confirmar: '1'
		});
		expect(redirecionouPara(r)).toBe(true);
		expect(ler().status).toBe('descartado');
	});

	it('os dois motivos não caem no mesmo status', async () => {
		imprimir();
		await chamar(rolos.encerrar, { id: String(roloId), motivo: 'acabou', confirmar: '1' });
		const comoVazio = ler().status;
		db.update(schema.rolo).set({ status: 'aberto' }).where(eq(schema.rolo.id, roloId)).run();
		await chamar(rolos.encerrar, { id: String(roloId), motivo: 'sobra', confirmar: '1' });
		expect(ler().status).not.toBe(comoVazio);
	});

	it('sem motivo escolhido, recusa e não mexe no status', async () => {
		const r = await chamar(rolos.encerrar, { id: String(roloId), confirmar: '1' });
		expect(recusou(r)).toBe(true);
		expect(ler().status).toBe('aberto');
	});

	it('motivo fora das duas palavras é recusado, mesmo sendo o nome do status', async () => {
		expect(
			recusou(
				await chamar(rolos.encerrar, { id: String(roloId), motivo: 'vazio', confirmar: '1' })
			)
		).toBe(true);
		expect(ler().status).toBe('aberto');
	});

	// ── a confirmação explícita ──────────────────────────────────────────────

	it('sem confirmar, não encerra nada', async () => {
		const r = await chamar(rolos.encerrar, { id: String(roloId), motivo: 'acabou' });
		expect(recusou(r)).toBe(true);
		expect(ler().status).toBe('aberto');
	});

	it('rolo inexistente é recusado, não estoura', async () => {
		const r = await chamar(rolos.encerrar, { id: '99999', motivo: 'acabou', confirmar: '1' });
		expect(recusou(r)).toBe(true);
	});

	it('id malformado é recusado, não estoura', async () => {
		expect(
			recusou(await chamar(rolos.encerrar, { id: 'abc', motivo: 'acabou', confirmar: '1' }))
		).toBe(true);
	});
});

// ── a pesagem final ─────────────────────────────────────────────────────────

describe('/rolos ?/encerrar · a pesagem final', () => {
	it('grava a sobra pesada como aferição e ela vira a âncora do restante', async () => {
		imprimir(); // estimativa: 20 − 12 = 8 g
		await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '5',
			confirmar: '1'
		});

		const registradas = pesagens();
		expect(registradas).toHaveLength(1);
		expect(registradas[0].pesoLiquidoG).toBe(5);
		expect(estoqueDoRolo(db, roloId).restanteG).toBe(5);
	});

	it('a pesagem final se identifica como tal, e não como pesagem manual', async () => {
		imprimir();
		await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '5',
			confirmar: '1'
		});
		expect(pesagens()[0].observacao).toBe('pesagem final');
	});

	/**
	 * O zero é o número mais útil dos dois motivos e o único que `aferir`
	 * recusa — lá ele é sintoma de campo em branco (`Number('')` é 0). Aqui ele
	 * é uma afirmação: acabou, não sobrou nada.
	 */
	it('aceita zero no encerramento, que é o que “acabou” quer dizer', async () => {
		imprimir();
		const r = await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'acabou',
			sobra: '0',
			confirmar: '1'
		});
		expect(redirecionouPara(r)).toBe(true);
		expect(pesagens()).toHaveLength(1);
		expect(estoqueDoRolo(db, roloId).restanteG).toBe(0);
	});

	it('e a pesagem avulsa continua recusando zero, que lá é campo em branco', async () => {
		const r = await chamar(rolos.aferir, { roloId: String(roloId), pesoLiquidoG: '0' });
		expect(recusou(r)).toBe(true);
		expect(pesagens()).toHaveLength(0);
	});

	it('pesagem em branco é resposta legítima: encerra sem gravar aferição nenhuma', async () => {
		imprimir();
		const r = await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '',
			confirmar: '1'
		});
		expect(redirecionouPara(r)).toBe(true);
		expect(ler().status).toBe('descartado');
		expect(pesagens()).toHaveLength(0);
	});

	it('pesagem digitada errada é erro, e não uma pesagem perdida em silêncio', async () => {
		const r = await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: 'abc',
			confirmar: '1'
		});
		expect(recusou(r)).toBe(true);
		expect(ler().status).toBe('aberto');
		expect(pesagens()).toHaveLength(0);
	});

	it('pesagem negativa é recusada', async () => {
		const r = await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '-3',
			confirmar: '1'
		});
		expect(recusou(r)).toBe(true);
		expect(ler().status).toBe('aberto');
	});

	/**
	 * Mesma regra de `validarPesoAferido`, e pelo mesmo motivo: filamento não
	 * brota no carretel, e a pesagem é a âncora de tudo que vem depois. O que
	 * este teste trava a mais é a ATOMICIDADE — a validação vem antes do
	 * update, então uma sobra impossível não deixa o rolo encerrado.
	 */
	it('sobra maior que o peso inicial é recusada e o rolo NÃO fica encerrado', async () => {
		const r = await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '900',
			confirmar: '1'
		});
		expect(recusou(r)).toBe(true);
		expect(ler().status).toBe('aberto');
		expect(pesagens()).toHaveLength(0);
	});
});

// ── a comparação estimada × real ────────────────────────────────────────────

describe('/rolos · quanto o rolo rendeu contra a estimativa do fatiador', () => {
	it('compara a sobra estimada de ANTES da pesagem com a sobra pesada', async () => {
		imprimir(); // estimativa: 8 g
		await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '5',
			confirmar: '1'
		});

		const dados = await carregar();
		const leitura = dados.encerrados[0].rendimento;
		expect(leitura.ok).toBe(true);
		// 8 g estimados contra 5 g reais. Se a pesagem entrasse ANTES do
		// cálculo da estimativa, ela seria a própria âncora e os dois números
		// dariam 5 — a comparação viraria "0 g de diferença", sempre.
		if (!leitura.ok) return;
		expect(leitura.rendimento.estimadaG).toBe(8);
		expect(leitura.rendimento.realG).toBe(5);
		expect(leitura.rendimento.diferencaG).toBe(-3);
		expect(leitura.rendimento.sentido).toBe('a-menos');
	});

	it('num rolo de amostra a comparação existe, mas vem marcada como ruído', async () => {
		imprimir();
		await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '5',
			confirmar: '1'
		});
		const dados = await carregar();
		const leitura = dados.encerrados[0].rendimento;
		expect(leitura.ok && leitura.rendimento.relevante).toBe(false);
	});

	it('sem pesagem final não há comparação — e a tela não inventa uma', async () => {
		imprimir();
		await chamar(rolos.encerrar, { id: String(roloId), motivo: 'sobra', confirmar: '1' });
		const dados = await carregar();
		expect(dados.encerrados[0].rendimento).toEqual({ ok: false, motivo: 'sem-pesagem' });
	});

	/**
	 * Encerrar com pesagem, reabrir, imprimir mais e encerrar de novo sem pesar
	 * é um caminho real — e nele a estimativa passa a descontar peças que a
	 * balança nunca viu. Os dois números viram instantes diferentes com um
	 * rótulo dizendo que são o mesmo, que é pior que não mostrar nada.
	 */
	it('rolo que voltou a imprimir depois da pesagem final não mostra comparação velha', async () => {
		imprimir();
		await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '5',
			confirmar: '1'
		});
		await chamar(rolos.reabrir, { id: String(roloId), confirmar: '1' });
		registrarImpressao(db, {
			nomeLivre: 'mais uma peça',
			impressoraId,
			roloId,
			inicioEm: Date.now() + 60_000,
			duracaoS: 600,
			gramas: 2,
			status: 'sucesso',
			finalidade: 'estudio',
			origem: 'manual'
		});
		await chamar(rolos.encerrar, { id: String(roloId), motivo: 'acabou', confirmar: '1' });

		const dados = await carregar();
		expect(dados.encerrados[0].rendimento).toEqual({ ok: false, motivo: 'usado-depois' });
	});

	it('impressão lançada depois da pesagem final não é descontada da sobra real', async () => {
		imprimir(); // estimativa: 8 g
		await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '5',
			confirmar: '1'
		});
		// Uma peça antiga lançada retroativamente, com início ANTES da pesagem.
		registrarImpressao(db, {
			nomeLivre: 'peça antiga',
			impressoraId,
			roloId,
			inicioEm: INICIO - 86_400_000,
			duracaoS: 600,
			gramas: 2,
			status: 'sucesso',
			finalidade: 'estudio',
			origem: 'manual'
		});
		const dados = await carregar();
		const leitura = dados.encerrados[0].rendimento;
		expect(leitura.ok && leitura.rendimento.realG).toBe(5);
		expect(dados.encerrados[0].estoque.restanteG).toBe(5);
	});
});

// ── o que sai das listas, e o que continua ──────────────────────────────────

describe('rolo encerrado · sai de circulação e continua no histórico', () => {
	async function encerrado() {
		const impressao = imprimir();
		await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '5',
			confirmar: '1'
		});
		return impressao;
	}

	it('sai do formulário de nova impressão', async () => {
		await encerrado();
		const dados = (await impressoes.load(ctxImpressoes() as never)) as {
			rolos: { codigo: string }[];
		};
		expect(dados.rolos.map((r) => r.codigo)).toEqual([]);
	});

	it('continua na tela de correção de impressão antiga, que é o caso legítimo', async () => {
		const impressao = await encerrado();
		const dados = (await impressoesId.load({
			params: { id: String(impressao.id) },
			url: new URL(`http://localhost/impressoes/${impressao.id}`)
		} as never)) as { rolos: { codigo: string }[] };
		expect(dados.rolos.map((r) => r.codigo)).toContain('PLA-BRANCO-01');
	});

	it('as impressões dele continuam íntegras, com o custo congelado onde estava', async () => {
		const impressao = await encerrado();
		const depois = db
			.select()
			.from(schema.impressao)
			.where(eq(schema.impressao.id, impressao.id))
			.get()!;
		expect(depois.roloId).toBe(roloId);
		expect(depois.gramas).toBe(12);
		expect(depois.custoTotalCents).toBe(impressao.custoTotalCents);
	});

	it('a lista de filamentos separa em circulação de encerrados', async () => {
		await encerrado();
		const dados = await carregar();
		expect(dados.ativos.map((r) => r.codigo)).toEqual([]);
		expect(dados.encerrados.map((r) => r.codigo)).toEqual(['PLA-BRANCO-01']);
	});

	/**
	 * Um rolo encerrado com 5 g bate os dois gatilhos de "acabando". Alertar
	 * sobre ele é justamente o barulho que o dono quis calar: ele já disse que
	 * não vai mais usar esse rolo.
	 */
	it('não alerta mais sobre um rolo que o dono já encerrou', async () => {
		await encerrado();
		const dados = await carregar();
		expect(dados.encerrados[0].alertas).toEqual([]);
	});

	it('o rolo em circulação continua alertando normalmente', async () => {
		imprimir(18); // sobra 2 g de 20 g
		const dados = await carregar();
		expect(dados.ativos).toHaveLength(1);
		const ativo = dados.ativos[0] as unknown as { alertas: { tipo: string }[] };
		expect(ativo.alertas.map((a) => a.tipo)).toContain('acabando');
	});
});

// ── a volta ─────────────────────────────────────────────────────────────────

describe('/rolos ?/reabrir · encerrar por engano não é definitivo', () => {
	async function encerrar(motivo = 'sobra', sobra = '5') {
		imprimir();
		await chamar(rolos.encerrar, { id: String(roloId), motivo, sobra, confirmar: '1' });
	}

	it('devolve para “aberto” o rolo que já tinha sido aberto', async () => {
		await encerrar();
		const r = await chamar(rolos.reabrir, { id: String(roloId), confirmar: '1' });
		expect(redirecionouPara(r)).toBe(true);
		expect(ler().status).toBe('aberto');
	});

	/**
	 * Um rolo lacrado também pode ser encerrado (comprei e desisti). Devolvê-lo
	 * como "aberto" inventaria uma abertura que nunca houve — e é `dataAbertura`
	 * que liga os alertas de umidade.
	 */
	it('devolve para “fechado” o rolo que nunca foi aberto', async () => {
		db.update(schema.rolo)
			.set({ status: 'fechado', dataAbertura: null })
			.where(eq(schema.rolo.id, roloId))
			.run();
		await chamar(rolos.encerrar, { id: String(roloId), motivo: 'sobra', confirmar: '1' });
		await chamar(rolos.reabrir, { id: String(roloId), confirmar: '1' });

		const rolo = ler();
		expect(rolo.status).toBe('fechado');
		expect(rolo.dataAbertura).toBeNull();
	});

	/**
	 * A pesagem é uma medida real da balança; o status é uma intenção. Reabrir
	 * corrige a intenção, não a medida — e a medida continua sendo a melhor
	 * âncora do que há no carretel agora. Quem quiser apagá-la tem a tela
	 * própria, que explica o que acontece com a âncora.
	 */
	it('a pesagem final CONTINUA registrada, e continua ancorando o restante', async () => {
		await encerrar();
		await chamar(rolos.reabrir, { id: String(roloId), confirmar: '1' });

		expect(pesagens()).toHaveLength(1);
		expect(pesagens()[0].pesoLiquidoG).toBe(5);
		expect(estoqueDoRolo(db, roloId).restanteG).toBe(5);
	});

	it('reaberto, o rolo volta ao formulário de nova impressão', async () => {
		await encerrar();
		await chamar(rolos.reabrir, { id: String(roloId), confirmar: '1' });
		const dados = (await impressoes.load(ctxImpressoes() as never)) as {
			rolos: { codigo: string }[];
		};
		expect(dados.rolos.map((r) => r.codigo)).toEqual(['PLA-BRANCO-01']);
	});

	it('reaberto, volta para a lista de filamentos em circulação', async () => {
		await encerrar();
		await chamar(rolos.reabrir, { id: String(roloId), confirmar: '1' });
		const dados = await carregar();
		expect(dados.ativos.map((r) => r.codigo)).toEqual(['PLA-BRANCO-01']);
		expect(dados.encerrados).toEqual([]);
	});

	it('sem confirmar, não reabre', async () => {
		await encerrar();
		const r = await chamar(rolos.reabrir, { id: String(roloId) });
		expect(recusou(r)).toBe(true);
		expect(ler().status).toBe('descartado');
	});

	it('reabrir um rolo que não está encerrado é recusado', async () => {
		const r = await chamar(rolos.reabrir, { id: String(roloId), confirmar: '1' });
		expect(recusou(r)).toBe(true);
		expect(ler().status).toBe('aberto');
	});

	it('rolo inexistente é recusado, não estoura', async () => {
		expect(recusou(await chamar(rolos.reabrir, { id: '99999', confirmar: '1' }))).toBe(true);
	});
});

// ── os passos revelados por query string ────────────────────────────────────

describe('/rolos load · confirmação revelada pela URL, sem JavaScript', () => {
	it('?encerrar=<id> abre o passo com a sobra estimada de hoje', async () => {
		imprimir();
		const dados = await carregar(`?encerrar=${roloId}`);
		expect(dados.encerrando?.id).toBe(roloId);
		expect(dados.encerrando?.sobraEstimadaG).toBe(8);
	});

	it('?encerrar apontando para rolo inexistente não abre passo nenhum', async () => {
		expect((await carregar('?encerrar=99999')).encerrando).toBeNull();
		expect((await carregar('?encerrar=abc')).encerrando).toBeNull();
	});

	/**
	 * O passo é sobre tirar de circulação um rolo que está em circulação.
	 * Abri-lo para um rolo já encerrado mostraria um formulário cuja única
	 * saída seria a action recusar depois — e, pior, com um radio pedindo de
	 * novo uma escolha que já foi feita.
	 */
	it('?encerrar de um rolo JÁ encerrado não abre passo nenhum', async () => {
		imprimir();
		await chamar(rolos.encerrar, { id: String(roloId), motivo: 'sobra', confirmar: '1' });
		expect((await carregar(`?encerrar=${roloId}`)).encerrando).toBeNull();
	});

	it('?reabrir=<id> abre o passo e mostra qual pesagem final está em jogo', async () => {
		imprimir();
		await chamar(rolos.encerrar, {
			id: String(roloId),
			motivo: 'sobra',
			sobra: '5',
			confirmar: '1'
		});
		const dados = await carregar(`?reabrir=${roloId}`);
		expect(dados.reabrindo?.id).toBe(roloId);
		expect(dados.reabrindo?.pesagemFinal?.pesoLiquidoG).toBe(5);
	});

	it('?reabrir de um rolo em circulação não abre passo nenhum', async () => {
		const dados = await carregar(`?reabrir=${roloId}`);
		expect(dados.reabrindo).toBeNull();
	});
});
