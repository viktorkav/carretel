import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from './db/schema';
import {
	criarRolo,
	dependentesDaImpressora,
	dependentesDoRolo,
	editarImpressao,
	editarImpressora,
	editarRolo,
	estoqueDoRolo,
	excluirAfericao,
	excluirImpressao,
	excluirImpressora,
	excluirRolo,
	horasAcumuladas,
	recalcularImpressao,
	recalcularImpressoesDaImpressora,
	recalcularImpressoesDoRolo,
	registrarImpressao
} from './repo';

function montar() {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './drizzle' });
	db.insert(schema.config).values({ id: 1, tarifaKwhCents: 95 }).run();

	const [imp] = db
		.insert(schema.impressora)
		.values({
			nome: 'A1',
			modelo: 'Bambu Lab A1',
			precoCompraCents: 250000,
			vidaUtilHoras: 5000,
			potenciaMediaW: 100
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
			precoPagoCents: 12000,
			pesoLiquidoInicialG: 1000
		})
		.returning()
		.all();

	return { db, impressoraId: imp.id, roloId: rol.id };
}

type Ctx = ReturnType<typeof montar>;
let ctx: Ctx;
beforeEach(() => {
	ctx = montar();
});

/** Uma impressão de 1 h e 100 g na máquina e no rolo do fixture. */
function umaImpressao(over: Partial<Parameters<typeof registrarImpressao>[1]> = {}) {
	return registrarImpressao(ctx.db, {
		nomeLivre: 'peça',
		impressoraId: ctx.impressoraId,
		roloId: ctx.roloId,
		inicioEm: 1_754_700_000_000,
		duracaoS: 3600,
		gramas: 100,
		status: 'sucesso',
		finalidade: 'estudio',
		origem: 'manual',
		...over
	});
}

function lerImpressao(id: number) {
	return ctx.db.select().from(schema.impressao).where(eq(schema.impressao.id, id)).get()!;
}

function baseEdicao(id: number) {
	const i = lerImpressao(id);
	return {
		nomeLivre: i.nomeLivre,
		impressoraId: i.impressoraId,
		roloId: i.roloId,
		inicioEm: i.inicioEm.getTime(),
		duracaoS: i.duracaoS,
		gramas: i.gramas,
		status: i.status,
		motivoFalha: i.motivoFalha,
		camadaMm: i.camadaMm,
		paredes: i.paredes,
		infillPct: i.infillPct,
		finalidade: i.finalidade,
		observacoes: i.observacoes
	};
}

// ── recálculo ───────────────────────────────────────────────────────────────

describe('recalcularImpressao', () => {
	it('reescreve o custo congelado com os valores de hoje dos cadastros', () => {
		const imp = umaImpressao();
		expect(imp.custoTotalCents).toBe(1260);

		// O preço da impressora estava errado: era 5.000, não 2.500.
		ctx.db
			.update(schema.impressora)
			.set({ precoCompraCents: 500000 })
			.where(eq(schema.impressora.id, ctx.impressoraId))
			.run();

		expect(recalcularImpressao(ctx.db, imp.id)).toBe(true);

		const depois = lerImpressao(imp.id);
		// depreciação dobra: 1 h × (500000 / 5000) = 100
		expect(depois.custoDepreciacaoCents).toBe(100);
		expect(depois.custoFilamentoCents).toBe(1200);
		expect(depois.custoEnergiaCents).toBe(10);
		expect(depois.custoTotalCents).toBe(1310);
	});

	it('sem recálculo o custo continua congelado depois da correção', () => {
		const imp = umaImpressao();
		ctx.db
			.update(schema.impressora)
			.set({ precoCompraCents: 500000 })
			.where(eq(schema.impressora.id, ctx.impressoraId))
			.run();

		expect(lerImpressao(imp.id).custoTotalCents).toBe(1260);
	});

	it('usa a tarifa de energia de hoje, não a do dia do registro', () => {
		const imp = umaImpressao();
		ctx.db.update(schema.config).set({ tarifaKwhCents: 190 }).run();

		recalcularImpressao(ctx.db, imp.id);
		// 1 h × 0,1 kW × 190 = 19
		expect(lerImpressao(imp.id).custoEnergiaCents).toBe(19);
	});

	it('devolve false e não grava nada quando a impressão não existe', () => {
		const imp = umaImpressao();
		expect(recalcularImpressao(ctx.db, 99999)).toBe(false);
		expect(lerImpressao(imp.id).custoTotalCents).toBe(1260);
	});
});

/**
 * A parcela de manutenção é a única que muda sozinha com o tempo: ela é diluída
 * pelas horas acumuladas da máquina, que crescem a cada impressão registrada.
 *
 * O `exceto` de `horasAcumuladas` compra UMA garantia, e só ela: a impressão
 * não dilui a si mesma, então recalcular a MAIS RECENTE devolve o mesmo número
 * que o registro dela produziu. Não compra idempotência geral — recalcular uma
 * impressão ANTIGA muda o número mesmo sem ninguém ter editado nada, e isso é o
 * recálculo cumprindo o que promete (valores de hoje), não um defeito. Os dois
 * casos estão travados abaixo, cada um com o nome do que ele garante.
 */
describe('parcela de manutenção no recálculo', () => {
	/** A (1 h) → manutenção de 6000 → B (2 h). Devolve os ids. */
	function cenarioComManutencao() {
		const a = umaImpressao(); // A: 1 h, registrada antes da manutenção
		ctx.db
			.insert(schema.manutencao)
			.values({ impressoraId: ctx.impressoraId, tipo: 'bico', custoCents: 6000 })
			.run();
		const b = umaImpressao({ duracaoS: 7200, gramas: 10 }); // B: 2 h
		return { a, b };
	}

	it('recalcular a impressão MAIS RECENTE devolve exatamente o número do registro', () => {
		const { b } = cenarioComManutencao();

		// No registro de B, as horas acumuladas eram as de A (1 h): 6000/h.
		expect(b.custoManutencaoCents).toBe(12000);
		const antes = lerImpressao(b.id);

		recalcularImpressao(ctx.db, b.id);

		// Se B entrasse no próprio denominador (3 h), a taxa cairia para 2000/h
		// e a parcela viraria 4000 — número que registro nenhum produziria.
		const depois = lerImpressao(b.id);
		expect(depois.custoManutencaoCents).toBe(12000);
		expect(depois.custoTotalCents).toBe(antes.custoTotalCents);
	});

	it('recalcular uma impressão ANTIGA muda o número, porque o horímetro de hoje é outro', () => {
		const { a } = cenarioComManutencao();

		// A foi registrada quando não havia manutenção nem horas acumuladas.
		expect(a.custoManutencaoCents).toBe(0);
		expect(a.custoTotalCents).toBe(1260);

		recalcularImpressao(ctx.db, a.id);

		// Horas de hoje, tirando a própria A: 2 h (B) → 3000/h → 1 h × 3000.
		// É a diferença que as três telas avisam por escrito antes de o usuário
		// marcar "Recalcular".
		const depois = lerImpressao(a.id);
		expect(depois.custoManutencaoCents).toBe(3000);
		expect(depois.custoTotalCents).toBe(4260);
	});

	it('recalcular duas vezes seguidas não move mais nada — a mudança é do horímetro, não do ato', () => {
		const { a } = cenarioComManutencao();

		recalcularImpressao(ctx.db, a.id);
		const primeira = lerImpressao(a.id);
		recalcularImpressao(ctx.db, a.id);
		const segunda = lerImpressao(a.id);

		expect(segunda.custoManutencaoCents).toBe(primeira.custoManutencaoCents);
		expect(segunda.custoTotalCents).toBe(primeira.custoTotalCents);
	});
});

describe('horasAcumuladas', () => {
	it('sabe excluir uma impressão da soma', () => {
		const a = umaImpressao({ duracaoS: 3600 });
		umaImpressao({ duracaoS: 7200 });

		expect(horasAcumuladas(ctx.db, ctx.impressoraId)).toBeCloseTo(3);
		expect(horasAcumuladas(ctx.db, ctx.impressoraId, a.id)).toBeCloseTo(2);
	});
});

describe('recálculo em lote', () => {
	it('recalcula só as impressões da impressora corrigida e devolve quantas foram', () => {
		const [outra] = ctx.db
			.insert(schema.impressora)
			.values({ nome: 'P1S', modelo: 'P1S', precoCompraCents: 100000, vidaUtilHoras: 5000 })
			.returning()
			.all();

		const a = umaImpressao();
		const b = umaImpressao();
		const c = umaImpressao({ impressoraId: outra.id });

		ctx.db
			.update(schema.impressora)
			.set({ precoCompraCents: 500000 })
			.where(eq(schema.impressora.id, ctx.impressoraId))
			.run();

		expect(recalcularImpressoesDaImpressora(ctx.db, ctx.impressoraId)).toBe(2);
		expect(lerImpressao(a.id).custoDepreciacaoCents).toBe(100);
		expect(lerImpressao(b.id).custoDepreciacaoCents).toBe(100);
		// A impressão da outra máquina não foi tocada.
		expect(lerImpressao(c.id).custoDepreciacaoCents).toBe(20);
	});

	it('recalcula só as impressões do rolo corrigido', () => {
		const [outroRolo] = ctx.db
			.insert(schema.rolo)
			.values({
				codigo: 'PLA-PRETO-02',
				marca: 'Bambu',
				material: 'PLA',
				cor: 'Preto',
				precoPagoCents: 20000,
				pesoLiquidoInicialG: 1000
			})
			.returning()
			.all();

		const a = umaImpressao();
		const b = umaImpressao({ roloId: outroRolo.id });

		// O rolo custou 60,00, não 120,00.
		ctx.db
			.update(schema.rolo)
			.set({ precoPagoCents: 6000 })
			.where(eq(schema.rolo.id, ctx.roloId))
			.run();

		expect(recalcularImpressoesDoRolo(ctx.db, ctx.roloId)).toBe(1);
		expect(lerImpressao(a.id).custoFilamentoCents).toBe(600);
		expect(lerImpressao(b.id).custoFilamentoCents).toBe(2000);
	});
});

// ── edição de impressão ─────────────────────────────────────────────────────

describe('editarImpressao', () => {
	it('mudar as gramas move o estoque do rolo mesmo sem recalcular o custo', () => {
		const imp = umaImpressao();
		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(900);

		const r = editarImpressao(ctx.db, imp.id, { ...baseEdicao(imp.id), gramas: 40 }, false);
		expect(r.ok).toBe(true);

		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(960);
		// Custo continua congelado: o usuário não pediu recálculo.
		expect(lerImpressao(imp.id).custoFilamentoCents).toBe(1200);
	});

	it('mudar as gramas com recálculo acerta custo e estoque juntos', () => {
		const imp = umaImpressao();

		const r = editarImpressao(ctx.db, imp.id, { ...baseEdicao(imp.id), gramas: 40 }, true);
		expect(r).toEqual({ ok: true, recalculadas: 1 });

		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(960);
		expect(lerImpressao(imp.id).custoFilamentoCents).toBe(480);
		expect(lerImpressao(imp.id).custoTotalCents).toBe(540);
	});

	it('trocar o rolo devolve o filamento ao rolo antigo e desconta do novo', () => {
		const [outroRolo] = ctx.db
			.insert(schema.rolo)
			.values({
				codigo: 'PLA-PRETO-02',
				marca: 'Bambu',
				material: 'PLA',
				cor: 'Preto',
				precoPagoCents: 20000,
				pesoLiquidoInicialG: 1000
			})
			.returning()
			.all();

		const imp = umaImpressao();
		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(900);
		expect(estoqueDoRolo(ctx.db, outroRolo.id).restanteG).toBe(1000);

		editarImpressao(ctx.db, imp.id, { ...baseEdicao(imp.id), roloId: outroRolo.id }, true);

		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(1000);
		expect(estoqueDoRolo(ctx.db, outroRolo.id).restanteG).toBe(900);
		// O recálculo usa o preço do rolo NOVO: 100 g × 20 c/g.
		expect(lerImpressao(imp.id).custoFilamentoCents).toBe(2000);
	});

	it('recusa impressora inexistente sem gravar nada', () => {
		const imp = umaImpressao();
		const r = editarImpressao(
			ctx.db,
			imp.id,
			{ ...baseEdicao(imp.id), impressoraId: 99999, gramas: 7 },
			true
		);
		expect(r.ok).toBe(false);
		expect(lerImpressao(imp.id).gramas).toBe(100);
	});

	it('recusa rolo inexistente sem gravar nada', () => {
		const imp = umaImpressao();
		const r = editarImpressao(
			ctx.db,
			imp.id,
			{ ...baseEdicao(imp.id), roloId: 99999, gramas: 7 },
			true
		);
		expect(r.ok).toBe(false);
		expect(lerImpressao(imp.id).gramas).toBe(100);
	});

	it('recusa impressão inexistente', () => {
		const imp = umaImpressao();
		const r = editarImpressao(ctx.db, 99999, baseEdicao(imp.id), false);
		expect(r.ok).toBe(false);
	});
});

// ── edição de cadastros ─────────────────────────────────────────────────────

describe('editarImpressora', () => {
	const dados = {
		nome: 'A1 mini',
		modelo: 'Bambu Lab A1 mini',
		apelidoBambu: 'Unit-01(A1)',
		precoCompraCents: 500000,
		vidaUtilHoras: 5000,
		potenciaMediaW: 100,
		ativa: true
	};

	it('grava os campos e não toca no custo quando não se pede recálculo', () => {
		const imp = umaImpressao();
		const r = editarImpressora(ctx.db, ctx.impressoraId, dados, false);
		expect(r).toEqual({ ok: true, recalculadas: 0 });

		const lida = ctx.db
			.select()
			.from(schema.impressora)
			.where(eq(schema.impressora.id, ctx.impressoraId))
			.get()!;
		expect(lida.nome).toBe('A1 mini');
		expect(lida.precoCompraCents).toBe(500000);
		expect(lerImpressao(imp.id).custoTotalCents).toBe(1260);
	});

	it('recalcula as impressões quando se pede', () => {
		const imp = umaImpressao();
		const r = editarImpressora(ctx.db, ctx.impressoraId, dados, true);
		expect(r).toEqual({ ok: true, recalculadas: 1 });
		expect(lerImpressao(imp.id).custoTotalCents).toBe(1310);
	});

	it('recusa impressora inexistente', () => {
		expect(editarImpressora(ctx.db, 99999, dados, true).ok).toBe(false);
	});
});

describe('editarRolo', () => {
	function dados(over: Record<string, unknown> = {}) {
		return {
			codigo: 'PLA-PRETO-01',
			marca: 'Bambu',
			material: 'PLA',
			cor: 'Preto',
			corHex: null,
			densidade: 1.24,
			tempBico: null,
			tempMesa: null,
			codigoBambu: null,
			fonteCatalogo: 'manual' as const,
			apelido: 'rolo do estúdio',
			precoPagoCents: 6000,
			pesoLiquidoInicialG: 1000,
			pesoCarretelG: 250,
			fornecedor: 'Loja X',
			notas: null,
			status: 'aberto' as const,
			...over
		};
	}

	it('corrigir o preço e pedir recálculo reescreve o custo de filamento', () => {
		const imp = umaImpressao();
		const r = editarRolo(ctx.db, ctx.roloId, dados(), true);
		expect(r).toEqual({ ok: true, recalculadas: 1 });
		expect(lerImpressao(imp.id).custoFilamentoCents).toBe(600);
		expect(lerImpressao(imp.id).custoTotalCents).toBe(660);
	});

	it('sem recálculo, só o cadastro muda', () => {
		const imp = umaImpressao();
		editarRolo(ctx.db, ctx.roloId, dados(), false);
		const rol = ctx.db.select().from(schema.rolo).where(eq(schema.rolo.id, ctx.roloId)).get()!;
		expect(rol.precoPagoCents).toBe(6000);
		expect(rol.fornecedor).toBe('Loja X');
		expect(lerImpressao(imp.id).custoFilamentoCents).toBe(1200);
	});

	it('mudar o peso inicial muda o estoque', () => {
		umaImpressao();
		editarRolo(ctx.db, ctx.roloId, dados({ pesoLiquidoInicialG: 750 }), false);
		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(650);
	});

	it('recusa peso inicial abaixo de uma pesagem já registrada', () => {
		ctx.db
			.insert(schema.afericao)
			.values({ roloId: ctx.roloId, pesoLiquidoG: 800, dataEm: new Date(1_754_800_000_000) })
			.run();

		const r = editarRolo(ctx.db, ctx.roloId, dados({ pesoLiquidoInicialG: 500 }), false);
		expect(r.ok).toBe(false);

		const rol = ctx.db.select().from(schema.rolo).where(eq(schema.rolo.id, ctx.roloId)).get()!;
		expect(rol.pesoLiquidoInicialG).toBe(1000);
	});

	it('grava a ficha do filamento, que agora mora no rolo', () => {
		editarRolo(
			ctx.db,
			ctx.roloId,
			dados({ marca: 'Voolt', material: 'PETG', cor: 'Cinza', densidade: 1.27, tempBico: 240 }),
			false
		);
		const rol = ctx.db.select().from(schema.rolo).where(eq(schema.rolo.id, ctx.roloId)).get()!;
		expect(rol.marca).toBe('Voolt');
		expect(rol.material).toBe('PETG');
		expect(rol.cor).toBe('Cinza');
		expect(rol.densidade).toBeCloseTo(1.27);
		expect(rol.tempBico).toBe(240);
	});

	it('mudar só a ficha não mexe em custo — o dinheiro sai do preço e do peso', () => {
		const imp = umaImpressao();
		editarRolo(ctx.db, ctx.roloId, dados({ precoPagoCents: 12000, marca: 'Voolt' }), true);
		expect(lerImpressao(imp.id).custoFilamentoCents).toBe(1200);
	});

	it('troca o código quando ele está livre', () => {
		expect(editarRolo(ctx.db, ctx.roloId, dados({ codigo: 'GAVETA2' }), false).ok).toBe(true);
		const rol = ctx.db.select().from(schema.rolo).where(eq(schema.rolo.id, ctx.roloId)).get()!;
		expect(rol.codigo).toBe('GAVETA2');
	});

	/**
	 * O índice único do banco já recusa — mas como exceção, ou seja, 500 na cara
	 * de quem digitou. Aqui a recusa é mensagem, e o cadastro não se mexe.
	 */
	it('recusa código que já é de outro rolo, sem gravar nada', () => {
		criarRolo(ctx.db, {
			marca: 'Bambu',
			material: 'PLA',
			cor: 'Preto',
			corHex: null,
			densidade: 1.24,
			tempBico: null,
			tempMesa: null,
			codigoBambu: null,
			fonteCatalogo: 'manual',
			apelido: null,
			precoPagoCents: 9900,
			pesoLiquidoInicialG: 1000,
			pesoCarretelG: 250,
			fornecedor: null
		});

		const r = editarRolo(ctx.db, ctx.roloId, dados({ codigo: 'PLA-PRETO-02' }), false);
		expect(r.ok).toBe(false);

		const rol = ctx.db.select().from(schema.rolo).where(eq(schema.rolo.id, ctx.roloId)).get()!;
		expect(rol.codigo).toBe('PLA-PRETO-01');
		expect(rol.precoPagoCents).toBe(12000);
	});

	it('aceita salvar mantendo o próprio código — a trava não pode brigar com ele mesmo', () => {
		expect(editarRolo(ctx.db, ctx.roloId, dados(), false).ok).toBe(true);
	});

	it('recusa rolo inexistente', () => {
		expect(editarRolo(ctx.db, 99999, dados(), false).ok).toBe(false);
	});
});

describe('criarRolo', () => {
	const compra = (over: Record<string, unknown> = {}) => ({
		marca: 'Bambu',
		material: 'PLA Basic',
		cor: 'Preto',
		corHex: '#000000',
		densidade: 1.26,
		tempBico: 220,
		tempMesa: 55,
		codigoBambu: 'GFA00',
		fonteCatalogo: 'manual' as const,
		apelido: null,
		precoPagoCents: 12000,
		pesoLiquidoInicialG: 1000,
		pesoCarretelG: 250,
		fornecedor: null,
		...over
	});

	/**
	 * A regra que a fusão existe para valer: comprar outro rolo igual NÃO soma
	 * ao anterior nem o atualiza — é um registro novo, com preço próprio e
	 * código próprio. Se algum dia alguém reintroduzir reaproveitamento, é aqui
	 * que quebra.
	 */
	it('duas compras do mesmo filamento viram DOIS registros, com preços independentes', () => {
		const a = criarRolo(ctx.db, compra({ precoPagoCents: 12000 }));
		const b = criarRolo(ctx.db, compra({ precoPagoCents: 15900 }));
		expect(a.ok && b.ok).toBe(true);
		expect(a.ok && b.ok && a.id).not.toBe(b.ok && b.id);

		const novos = ctx.db
			.select()
			.from(schema.rolo)
			.all()
			.filter((r) => r.id !== ctx.roloId);
		expect(novos.map((r) => r.precoPagoCents)).toEqual([12000, 15900]);
		expect(novos.map((r) => r.codigo)).toEqual(['PLA-PRETO-02', 'PLA-PRETO-03']);
	});

	it('preserva referência exata do catálogo e deixa compras manuais sem referência', () => {
		const resultado = criarRolo(ctx.db, compra({ catalogoItemId: 'ofd:esun_3d:preto' }));
		expect(resultado.ok).toBe(true);
		const novo = resultado.ok && ctx.db.select().from(schema.rolo).where(eq(schema.rolo.id, resultado.id)).get();
		expect(novo && ('catalogoItemId' in novo ? novo.catalogoItemId : undefined)).toBe('ofd:esun_3d:preto');
		const anterior = ctx.db.select().from(schema.rolo).where(eq(schema.rolo.id, ctx.roloId)).get()!;
		expect('catalogoItemId' in anterior ? anterior.catalogoItemId : undefined).toBeNull();
	});

	it('não mexe no rolo que já existia', () => {
		criarRolo(ctx.db, compra({ precoPagoCents: 15900 }));
		const antigo = ctx.db.select().from(schema.rolo).where(eq(schema.rolo.id, ctx.roloId)).get()!;
		expect(antigo.precoPagoCents).toBe(12000);
		expect(antigo.codigo).toBe('PLA-PRETO-01');
	});

	it('recusa com mensagem, e não com exceção, quando o código pedido já existe', () => {
		const r = criarRolo(ctx.db, compra({ codigo: 'PLA-PRETO-01' }));
		expect(r.ok).toBe(false);
		expect(r.ok === false && r.erro).toContain('PLA-PRETO-01');
	});
});

// ── exclusões ───────────────────────────────────────────────────────────────

describe('excluirImpressora', () => {
	it('recusa enquanto houver impressão dependente', () => {
		umaImpressao();
		expect(dependentesDaImpressora(ctx.db, ctx.impressoraId)).toEqual({
			impressoes: 1,
			manutencoes: 0
		});

		const r = excluirImpressora(ctx.db, ctx.impressoraId);
		expect(r.ok).toBe(false);
		expect(ctx.db.select().from(schema.impressora).all()).toHaveLength(1);
	});

	it('recusa enquanto houver manutenção dependente', () => {
		ctx.db
			.insert(schema.manutencao)
			.values({ impressoraId: ctx.impressoraId, tipo: 'bico', custoCents: 100 })
			.run();

		expect(excluirImpressora(ctx.db, ctx.impressoraId).ok).toBe(false);
		expect(ctx.db.select().from(schema.impressora).all()).toHaveLength(1);
	});

	it('apaga quando nada depende dela', () => {
		expect(excluirImpressora(ctx.db, ctx.impressoraId).ok).toBe(true);
		expect(ctx.db.select().from(schema.impressora).all()).toHaveLength(0);
	});

	it('recusa id inexistente', () => {
		expect(excluirImpressora(ctx.db, 99999).ok).toBe(false);
	});
});

describe('excluirRolo', () => {
	it('recusa enquanto houver impressão dependente', () => {
		umaImpressao();
		expect(dependentesDoRolo(ctx.db, ctx.roloId)).toEqual({ impressoes: 1, afericoes: 0 });
		expect(excluirRolo(ctx.db, ctx.roloId).ok).toBe(false);
		expect(ctx.db.select().from(schema.rolo).all()).toHaveLength(1);
	});

	it('apaga o rolo e as pesagens dele quando não há impressão', () => {
		ctx.db.insert(schema.afericao).values({ roloId: ctx.roloId, pesoLiquidoG: 800 }).run();
		ctx.db.insert(schema.afericao).values({ roloId: ctx.roloId, pesoLiquidoG: 700 }).run();

		expect(excluirRolo(ctx.db, ctx.roloId).ok).toBe(true);
		expect(ctx.db.select().from(schema.rolo).all()).toHaveLength(0);
		expect(ctx.db.select().from(schema.afericao).all()).toHaveLength(0);
	});

	it('recusa id inexistente', () => {
		expect(excluirRolo(ctx.db, 99999).ok).toBe(false);
	});
});

describe('excluirAfericao', () => {
	it('devolve a âncora do restante ao peso inicial do rolo', () => {
		umaImpressao({ inicioEm: 1_754_700_000_000, gramas: 100 });
		const [af] = ctx.db
			.insert(schema.afericao)
			.values({ roloId: ctx.roloId, pesoLiquidoG: 500, dataEm: new Date(1_754_800_000_000) })
			.returning()
			.all();
		umaImpressao({ inicioEm: 1_754_900_000_000, gramas: 50 });

		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(450);

		expect(excluirAfericao(ctx.db, af.id).ok).toBe(true);

		// Sem a pesagem errada, a base volta a ser o peso inicial e as duas
		// impressões voltam a contar: 1000 - 150.
		const estoque = estoqueDoRolo(ctx.db, ctx.roloId);
		expect(estoque.restanteG).toBe(850);
		expect(estoque.baseEm).toBe(null);
	});

	it('volta para a pesagem anterior quando existe mais de uma', () => {
		const [antiga] = ctx.db
			.insert(schema.afericao)
			.values({ roloId: ctx.roloId, pesoLiquidoG: 700, dataEm: new Date(1_754_700_000_000) })
			.returning()
			.all();
		const [recente] = ctx.db
			.insert(schema.afericao)
			.values({ roloId: ctx.roloId, pesoLiquidoG: 90, dataEm: new Date(1_754_800_000_000) })
			.returning()
			.all();

		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(90);

		excluirAfericao(ctx.db, recente.id);

		const estoque = estoqueDoRolo(ctx.db, ctx.roloId);
		expect(estoque.restanteG).toBe(700);
		expect(estoque.baseEm).toBe(1_754_700_000_000);
		expect(antiga.id).toBeGreaterThan(0);
	});

	it('recusa id inexistente', () => {
		expect(excluirAfericao(ctx.db, 99999).ok).toBe(false);
	});
});

describe('excluirImpressao', () => {
	it('devolve o filamento ao estoque do rolo', () => {
		const a = umaImpressao({ gramas: 100 });
		umaImpressao({ gramas: 50 });
		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(850);

		expect(excluirImpressao(ctx.db, a.id).ok).toBe(true);
		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(950);
		expect(ctx.db.select().from(schema.impressao).all()).toHaveLength(1);
	});

	it('recusa id inexistente', () => {
		expect(excluirImpressao(ctx.db, 99999).ok).toBe(false);
	});
});
