/**
 * Testes das ACTIONS da rodada de fluxo e entrada de dado (achados 5, 6, 7).
 *
 * Existem separados dos testes de helper pela mesma razão que `edicao-acoes` e
 * `fusao-acoes` existem: os três defeitos desta rodada moram na FIAÇÃO, não na
 * regra. `resolverPesagem` converte bruto em líquido perfeitamente enquanto a
 * action continuar lendo só o campo do líquido; `ecoDoFormulario` devolve o que
 * foi digitado enquanto ninguém o chamar; e `lerEntradasDoFormulario` lê
 * finalidade por linha enquanto a tela não mandar uma. Teste de helper passaria
 * feliz nos três casos.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'carretel-fluxo-')), 'teste.sqlite');

const { db, schema } = await import('$lib/server/db');
migrate(db, { migrationsFolder: './drizzle' });

const { registrarImpressao } = await import('$lib/server/repo');
const rolos = (await import('./rolos/+page.server')).actions;
const impressoes = (await import('./impressoes/+page.server')).actions;
const impressoras = (await import('./impressoras/+page.server')).actions;

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
			precoCompraCents: 400_000,
			vidaUtilHoras: 8000,
			potenciaMediaW: 150
		})
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
			densidade: 1.26,
			precoPagoCents: 12_000,
			pesoLiquidoInicialG: 1000,
			pesoCarretelG: 250,
			status: 'aberto'
		})
		.returning()
		.all();
	roloId = rol.id;
});

/** RequestEvent mínimo: estas actions só usam `request` (e `params`, quando há). */
function evento(campos: Record<string, string>) {
	const corpo = new FormData();
	for (const [chave, valor] of Object.entries(campos)) corpo.set(chave, valor);
	return { request: new Request('http://localhost/', { method: 'POST', body: corpo }) } as never;
}

type Retorno = {
	status?: number;
	data?: {
		erro?: string;
		campo?: string;
		valores?: Record<string, string>;
		erroLote?: string;
		[k: string]: unknown;
	};
	[k: string]: unknown;
};

async function chamar(
	action: (ev: never) => unknown,
	campos: Record<string, string>
): Promise<Retorno> {
	return (await action(evento(campos))) as Retorno;
}

const recusou = (r: Retorno) => r.status === 400 && typeof r.data?.erro === 'string';
const rolo = () => db.select().from(schema.rolo).where(eq(schema.rolo.id, roloId)).get()!;
const afericoes = () => db.select().from(schema.afericao).all();

// ════════════════════════════════════════════════════════════════════════════
// 6. A balança dá bruto; o formulário pedia líquido
// ════════════════════════════════════════════════════════════════════════════

describe('/rolos ?/aferir · a pesagem em bruto', () => {
	it('converte o bruto da balança e grava o líquido', async () => {
		const r = await chamar(rolos.aferir, { roloId: String(roloId), pesoBrutoG: '812' });

		expect(recusou(r)).toBe(false);
		expect(afericoes()).toHaveLength(1);
		expect(afericoes()[0].pesoLiquidoG).toBe(562);
	});

	it('deixa a observação dizer que o número veio de uma conversão', async () => {
		await chamar(rolos.aferir, { roloId: String(roloId), pesoBrutoG: '812' });
		expect(afericoes()[0].observacao).toMatch(/812/);
		expect(afericoes()[0].observacao).toMatch(/250/);
	});

	it('o líquido digitado direto continua valendo, para quem tirou o carretel', async () => {
		await chamar(rolos.aferir, { roloId: String(roloId), pesoLiquidoG: '480' });
		expect(afericoes()[0].pesoLiquidoG).toBe(480);
		expect(afericoes()[0].observacao).not.toMatch(/brutos/);
	});

	it('os dois campos preenchidos e coerentes gravam uma pesagem só', async () => {
		// É o que o JavaScript da tela deixa: digitar num campo preenche o outro.
		const r = await chamar(rolos.aferir, {
			roloId: String(roloId),
			pesoBrutoG: '812',
			pesoLiquidoG: '562'
		});
		expect(recusou(r)).toBe(false);
		expect(afericoes()).toHaveLength(1);
	});

	it('os dois campos brigando não gravam nada', async () => {
		const r = await chamar(rolos.aferir, {
			roloId: String(roloId),
			pesoBrutoG: '812',
			pesoLiquidoG: '400'
		});
		expect(recusou(r)).toBe(true);
		expect(afericoes()).toHaveLength(0);
	});

	it('nenhum dos dois preenchido não grava aferição de zero', async () => {
		// O defeito clássico: `Number('')` é 0, e 0 g ancorado é o rolo inteiro
		// reportando vazio para sempre.
		const r = await chamar(rolos.aferir, { roloId: String(roloId) });
		expect(recusou(r)).toBe(true);
		expect(afericoes()).toHaveLength(0);
	});

	it('devolve o digitado e o campo errado, sem apagar o formulário', async () => {
		const r = await chamar(rolos.aferir, { roloId: String(roloId), pesoBrutoG: '200' });
		expect(recusou(r)).toBe(true);
		expect(r.data?.valores?.pesoBrutoG).toBe('200');
		expect(r.data?.campo).toBe('pesoBrutoG');
		// E diz de QUAL rolo é o erro: a tela lista todos, cada um com o seu
		// formulário de pesagem.
		expect(r.data?.roloComErro).toBe(roloId);
	});
});

describe('/rolos ?/aferir · peso de fábrica acima do nominal', () => {
	it('recusa por padrão, e a mensagem carrega a saída', async () => {
		// 1024 g num rolo de 1000 é a tolerância de fábrica da Bambu, não erro de
		// balança. Recusar continua certo — a aferição é a âncora do estoque —,
		// mas recusar sem dizer o que fazer é beco.
		const r = await chamar(rolos.aferir, { roloId: String(roloId), pesoLiquidoG: '1024' });

		expect(recusou(r)).toBe(true);
		expect(r.data?.erro).toMatch(/ajustar o peso inicial/i);
		expect(afericoes()).toHaveLength(0);
		expect(rolo().pesoLiquidoInicialG).toBe(1000);
	});

	it('com o ajuste marcado, aceita e sobe o peso inicial junto', async () => {
		const r = await chamar(rolos.aferir, {
			roloId: String(roloId),
			pesoLiquidoG: '1024',
			ajustarInicial: 'on'
		});

		expect(recusou(r)).toBe(false);
		expect(rolo().pesoLiquidoInicialG).toBe(1024);
		expect(afericoes()[0].pesoLiquidoG).toBe(1024);
	});

	it('o ajuste marcado NÃO baixa o peso inicial numa pesagem comum', async () => {
		// O checkbox é "aceite para cima", e só. Se ele também descesse, uma
		// pesagem de meio rolo redefiniria o rolo como sendo de 500 g — e o
		// percentual de restante passaria a mentir para sempre.
		await chamar(rolos.aferir, {
			roloId: String(roloId),
			pesoLiquidoG: '480',
			ajustarInicial: 'on'
		});
		expect(rolo().pesoLiquidoInicialG).toBe(1000);
	});

	it('o ajuste é anunciado, e não feito em silêncio', async () => {
		const r = await chamar(rolos.aferir, {
			roloId: String(roloId),
			pesoLiquidoG: '1024',
			ajustarInicial: 'on'
		});
		expect(String(r.aviso)).toMatch(/peso inicial/);
	});
});

describe('/rolos ?/aferir · pesar abre o rolo', () => {
	beforeEach(() => {
		db.update(schema.rolo)
			.set({ status: 'fechado', dataAbertura: null })
			.where(eq(schema.rolo.id, roloId))
			.run();
	});

	it('pesar um rolo fechado o abre e carimba a data', async () => {
		// Rolo sem data de abertura não alerta acabando nem umidade — que são os
		// dois únicos alertas do sistema. Pesar é ter o rolo na mão.
		const r = await chamar(rolos.aferir, { roloId: String(roloId), pesoBrutoG: '1240' });

		expect(recusou(r)).toBe(false);
		expect(rolo().status).toBe('aberto');
		expect(rolo().dataAbertura).not.toBeNull();
		expect(String(r.aviso)).toMatch(/aberto/);
	});

	it('não mexe no status de um rolo que já estava aberto', async () => {
		db.update(schema.rolo)
			.set({ status: 'aberto', dataAbertura: new Date(INICIO) })
			.where(eq(schema.rolo.id, roloId))
			.run();

		const r = await chamar(rolos.aferir, { roloId: String(roloId), pesoBrutoG: '812' });

		expect(rolo().dataAbertura?.getTime()).toBe(INICIO);
		expect(r.aviso).toBeNull();
	});

	it('pesagem recusada não abre o rolo', async () => {
		// Efeito colateral em caminho de erro é a pior classe de bug desta tela.
		await chamar(rolos.aferir, { roloId: String(roloId), pesoBrutoG: '100' });
		expect(rolo().status).toBe('fechado');
		expect(rolo().dataAbertura).toBeNull();
	});
});

// ════════════════════════════════════════════════════════════════════════════
// 7. Erro de validação não apaga mais o formulário
// ════════════════════════════════════════════════════════════════════════════

describe('erro de validação devolve o que foi digitado', () => {
	const novaImpressao = (over: Record<string, string> = {}) => ({
		nomeLivre: 'suporte de câmera',
		impressoraId: String(impressoraId),
		roloId: String(roloId),
		duracao: '3,6h',
		gramas: '82,5',
		status: 'sucesso',
		finalidade: 'conteudo',
		...over
	});

	it('/impressoes ?/criar — onze campos sobrevivem a um erro no décimo segundo', async () => {
		const r = await chamar(impressoes.criar, novaImpressao({ gramas: 'abc' }));

		expect(recusou(r)).toBe(true);
		expect(r.data?.campo).toBe('gramas');
		expect(r.data?.valores?.nomeLivre).toBe('suporte de câmera');
		expect(r.data?.valores?.duracao).toBe('3,6h');
		expect(r.data?.valores?.finalidade).toBe('conteudo');
		expect(r.data?.valores?.gramas).toBe('abc');
	});

	it('/impressoes ?/criar — o campo apontado é o que falhou, não o primeiro', async () => {
		const r = await chamar(impressoes.criar, novaImpressao({ nomeLivre: '' }));
		expect(r.data?.campo).toBe('nomeLivre');

		const s = await chamar(impressoes.criar, novaImpressao({ infillPct: '-3' }));
		expect(s.data?.campo).toBe('infillPct');
	});

	it('/rolos ?/criar — o cadastro manual devolve a ficha inteira', async () => {
		const r = await chamar(rolos.criar, {
			marca: 'eSun',
			material: 'PETG',
			cor: 'Roxo',
			densidade: '1,27',
			tempBico: '250',
			preco: 'abc',
			pesoInicial: '1000',
			pesoCarretel: '250'
		});

		expect(recusou(r)).toBe(true);
		expect(r.data?.campo).toBe('preco');
		expect(r.data?.valores?.marca).toBe('eSun');
		expect(r.data?.valores?.material).toBe('PETG');
		expect(r.data?.valores?.densidade).toBe('1,27');
		expect(r.data?.valores?.tempBico).toBe('250');
	});

	it('/rolos ?/editar — o formulário volta como estava e diz de que rolo é', async () => {
		const r = await chamar(rolos.editar, {
			id: String(roloId),
			codigo: 'PLA-PRETO-01',
			marca: 'Bambu',
			material: 'PLA',
			cor: 'Preto',
			densidade: '1,26',
			preco: '120,00',
			pesoInicial: '',
			pesoCarretel: '250',
			status: 'aberto'
		});

		expect(recusou(r)).toBe(true);
		expect(r.data?.campo).toBe('pesoInicial');
		expect(r.data?.valores?.marca).toBe('Bambu');
		expect(r.data?.editandoId).toBe(roloId);
		// E não gravou nada: o rolo continua com o peso que tinha.
		expect(rolo().pesoLiquidoInicialG).toBe(1000);
	});

	it('/impressoras ?/criar — cinco campos voltam depois de um preço errado', async () => {
		const r = await chamar(impressoras.criar, {
			nome: 'A1 mini',
			modelo: 'Bambu Lab A1 mini',
			apelidoBambu: 'Unit-02(A1M)',
			preco: 'mil e quinhentos',
			vidaUtilHoras: '5000',
			potenciaMediaW: '100'
		});

		expect(recusou(r)).toBe(true);
		expect(r.data?.campo).toBe('preco');
		expect(r.data?.valores?.nome).toBe('A1 mini');
		expect(r.data?.valores?.apelidoBambu).toBe('Unit-02(A1M)');
	});

	it('erro que não é de campo nenhum não aponta campo nenhum', async () => {
		// "rolo não encontrado" não pertence a um controle. Marcar um ao acaso
		// seria pior do que não marcar.
		const r = await chamar(impressoes.criar, novaImpressao({ roloId: '99999' }));
		expect(recusou(r)).toBe(true);
		expect(r.data?.campo).toBe('roloId');

		const s = await chamar(rolos.aferir, { roloId: '99999', pesoLiquidoG: '500' });
		expect(recusou(s)).toBe(true);
		expect(s.data?.campo).toBeUndefined();
	});
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Finalidade em lote na lista de impressões
// ════════════════════════════════════════════════════════════════════════════

describe('/impressoes ?/finalidadeEmLote', () => {
	function gravar(nome: string) {
		return registrarImpressao(db, {
			nomeLivre: nome,
			impressoraId,
			roloId,
			inicioEm: INICIO,
			duracaoS: 3600,
			gramas: 100,
			status: 'sucesso',
			finalidade: 'outro',
			origem: 'nuvem'
		});
	}

	const finalidades = () =>
		new Map(
			db
				.select()
				.from(schema.impressao)
				.all()
				.map((i) => [i.nomeLivre, i.finalidade])
		);

	it('reclassifica as marcadas e só elas', async () => {
		const a = gravar('MagicTray');
		gravar('Gridfinity');
		const c = gravar('Suporte');

		const corpo = new FormData();
		corpo.append('finalidadeLote', 'homelab');
		corpo.append('escopo', 'marcadas');
		corpo.append('marcada', String(a.id));
		corpo.append('marcada', String(c.id));

		const r = (await impressoes.finalidadeEmLote({
			request: new Request('http://localhost/', { method: 'POST', body: corpo })
		} as never)) as Retorno;

		expect(r.sucessoLote).toBe(2);
		expect(finalidades().get('MagicTray')).toBe('homelab');
		expect(finalidades().get('Gridfinity')).toBe('outro');
		expect(finalidades().get('Suporte')).toBe('homelab');
	});

	it('o escopo "todas" usa os ids que o servidor desenhou, não o banco inteiro', async () => {
		// É o que faz o botão não mentir: o lote é exatamente o que está escrito
		// na tela — e é o que o mantém funcionando sem JavaScript.
		const a = gravar('MagicTray');
		gravar('fora da lista');

		const corpo = new FormData();
		corpo.append('finalidadeLote', 'conteudo');
		corpo.append('escopo', 'todas');
		corpo.append('listada', String(a.id));

		const r = (await impressoes.finalidadeEmLote({
			request: new Request('http://localhost/', { method: 'POST', body: corpo })
		} as never)) as Retorno;

		expect(r.sucessoLote).toBe(1);
		expect(finalidades().get('fora da lista')).toBe('outro');
	});

	it('sem nada marcado, recusa em vez de reclassificar tudo', async () => {
		gravar('MagicTray');
		const r = await chamar(impressoes.finalidadeEmLote, {
			finalidadeLote: 'homelab',
			escopo: 'marcadas'
		});

		expect(r.status).toBe(400);
		expect(String(r.data?.erroLote)).toMatch(/marque/);
		expect(finalidades().get('MagicTray')).toBe('outro');
	});

	it('finalidade fora do domínio não vira "outro" em silêncio — recusa', async () => {
		const a = gravar('MagicTray');
		const corpo = new FormData();
		corpo.append('finalidadeLote', 'sei-la');
		corpo.append('escopo', 'marcadas');
		corpo.append('marcada', String(a.id));

		const r = (await impressoes.finalidadeEmLote({
			request: new Request('http://localhost/', { method: 'POST', body: corpo })
		} as never)) as Retorno;

		expect(r.status).toBe(400);
		expect(finalidades().get('MagicTray')).toBe('outro');
	});

	it('reclassificar NÃO recalcula o custo congelado', async () => {
		const a = gravar('MagicTray');
		const antes = db.select().from(schema.impressao).where(eq(schema.impressao.id, a.id)).get()!;

		// Tarifa muda entre o registro e a reclassificação: se houvesse recálculo,
		// consertar o balde de uma peça de março passaria a usar a tarifa de hoje.
		db.update(schema.config).set({ tarifaKwhCents: 300 }).where(eq(schema.config.id, 1)).run();

		const corpo = new FormData();
		corpo.append('finalidadeLote', 'pessoal');
		corpo.append('escopo', 'marcadas');
		corpo.append('marcada', String(a.id));
		await impressoes.finalidadeEmLote({
			request: new Request('http://localhost/', { method: 'POST', body: corpo })
		} as never);

		const depois = db.select().from(schema.impressao).where(eq(schema.impressao.id, a.id)).get()!;
		expect(depois.finalidade).toBe('pessoal');
		expect(depois.custoTotalCents).toBe(antes.custoTotalCents);
		expect(depois.custoEnergiaCents).toBe(antes.custoEnergiaCents);
	});

	it('id adulterado no formulário não vira 500', async () => {
		gravar('MagicTray');
		const corpo = new FormData();
		corpo.append('finalidadeLote', 'homelab');
		corpo.append('escopo', 'marcadas');
		corpo.append('marcada', 'abc');
		corpo.append('marcada', '-1');

		const r = (await impressoes.finalidadeEmLote({
			request: new Request('http://localhost/', { method: 'POST', body: corpo })
		} as never)) as Retorno;

		expect(r.status).toBe(400);
		expect(finalidades().get('MagicTray')).toBe('outro');
	});
});
