import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from './db/schema';
import {
	aplicarFinalidadeEmLote,
	estoqueDoRolo,
	horasAcumuladas,
	lerConfig,
	registrarImpressao
} from './repo';

type Db = ReturnType<typeof montar>['db'];

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

let ctx: ReturnType<typeof montar>;
beforeEach(() => {
	ctx = montar();
});

describe('registrarImpressao', () => {
	it('congela o custo calculado no momento do registro', () => {
		const imp = registrarImpressao(ctx.db, {
			nomeLivre: 'caixa do Rode',
			impressoraId: ctx.impressoraId,
			roloId: ctx.roloId,
			inicioEm: 1_754_700_000_000,
			duracaoS: 3600,
			gramas: 100,
			status: 'sucesso',
			finalidade: 'estudio',
			origem: 'manual'
		});

		expect(imp.custoFilamentoCents).toBe(1200);
		expect(imp.custoEnergiaCents).toBe(10);
		expect(imp.custoDepreciacaoCents).toBe(50);
		expect(imp.custoTotalCents).toBe(1260);
	});

	it('mantém o custo antigo quando a tarifa muda depois', () => {
		const imp = registrarImpressao(ctx.db, {
			nomeLivre: 'peça',
			impressoraId: ctx.impressoraId,
			roloId: ctx.roloId,
			inicioEm: 1_754_700_000_000,
			duracaoS: 3600,
			gramas: 100,
			status: 'sucesso',
			finalidade: 'outro',
			origem: 'manual'
		});
		ctx.db.update(schema.config).set({ tarifaKwhCents: 500 }).run();

		const lido = ctx.db.select().from(schema.impressao).all()[0];
		expect(lido.custoTotalCents).toBe(imp.custoTotalCents);
	});
});

describe('horasAcumuladas', () => {
	it('soma a duração de todas as impressões da impressora, inclusive falhas', () => {
		for (const s of ['sucesso', 'falha'] as const) {
			registrarImpressao(ctx.db, {
				nomeLivre: 'x',
				impressoraId: ctx.impressoraId,
				roloId: ctx.roloId,
				inicioEm: 1_754_700_000_000,
				duracaoS: 1800,
				gramas: 10,
				status: s,
				finalidade: 'outro',
				origem: 'manual'
			});
		}
		// Falha também desgasta a máquina: 1800 + 1800 = 1 h
		expect(horasAcumuladas(ctx.db, ctx.impressoraId)).toBeCloseTo(1);
	});
});

describe('estoqueDoRolo', () => {
	it('reflete as impressões já registradas', () => {
		registrarImpressao(ctx.db, {
			nomeLivre: 'x',
			impressoraId: ctx.impressoraId,
			roloId: ctx.roloId,
			inicioEm: 1_754_700_000_000,
			duracaoS: 3600,
			gramas: 149,
			status: 'sucesso',
			finalidade: 'outro',
			origem: 'manual'
		});
		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(851);
	});

	it('usa a aferição mais recente como base, descartando impressões anteriores a ela', () => {
		// Consumo antes da pesagem — deve ser descartado, porque a balança já
		// contabilizou esse gasto no peso que ela mediu.
		registrarImpressao(ctx.db, {
			nomeLivre: 'antes da balança',
			impressoraId: ctx.impressoraId,
			roloId: ctx.roloId,
			inicioEm: 1_754_700_000_000,
			duracaoS: 3600,
			gramas: 100,
			status: 'sucesso',
			finalidade: 'outro',
			origem: 'manual'
		});
		ctx.db
			.insert(schema.afericao)
			.values({ roloId: ctx.roloId, pesoLiquidoG: 500, dataEm: new Date(1_754_800_000_000) })
			.run();
		registrarImpressao(ctx.db, {
			nomeLivre: 'depois da balança',
			impressoraId: ctx.impressoraId,
			roloId: ctx.roloId,
			inicioEm: 1_754_900_000_000,
			duracaoS: 3600,
			gramas: 50,
			status: 'sucesso',
			finalidade: 'outro',
			origem: 'manual'
		});
		// Base é a aferição (500g), não o peso inicial do rolo (1000g).
		// Só o consumo posterior à pesagem entra na conta: 500 - 50 = 450.
		expect(estoqueDoRolo(ctx.db, ctx.roloId).restanteG).toBe(450);
	});
});

describe('lerConfig', () => {
	it('cria a linha padrão quando ela ainda não existe', () => {
		ctx.db.delete(schema.config).run();
		const cfg = lerConfig(ctx.db);
		expect(cfg.id).toBe(1);
		expect(cfg.tarifaKwhCents).toBe(95);
	});
});

describe('aplicarFinalidadeEmLote', () => {
	function gravar(nome: string, finalidade: 'estudio' | 'outro' = 'outro') {
		return registrarImpressao(ctx.db, {
			nomeLivre: nome,
			impressoraId: ctx.impressoraId,
			roloId: ctx.roloId,
			inicioEm: 1_754_700_000_000,
			duracaoS: 3600,
			gramas: 100,
			status: 'sucesso',
			finalidade,
			origem: 'manual'
		});
	}

	it('reclassifica só as linhas pedidas', () => {
		const a = gravar('a');
		const b = gravar('b');
		const c = gravar('c');

		expect(aplicarFinalidadeEmLote(ctx.db, [a.id, c.id], 'homelab')).toBe(2);

		const por = new Map(
			ctx.db.select().from(schema.impressao).all().map((i) => [i.id, i.finalidade])
		);
		expect(por.get(a.id)).toBe('homelab');
		expect(por.get(b.id)).toBe('outro');
		expect(por.get(c.id)).toBe('homelab');
	});

	it('NÃO encosta no custo congelado', () => {
		// A finalidade é classificação, não parcela. Se ela recalculasse, corrigir
		// o balde de uma impressão de março passaria a usar a tarifa de agosto —
		// exatamente o que o projeto congela custo para impedir.
		const a = gravar('a');
		const antes = ctx.db.select().from(schema.impressao).all()[0];

		aplicarFinalidadeEmLote(ctx.db, [a.id], 'conteudo');

		const depois = ctx.db.select().from(schema.impressao).all()[0];
		expect(depois.custoTotalCents).toBe(antes.custoTotalCents);
		expect(depois.custoFilamentoCents).toBe(antes.custoFilamentoCents);
		expect(depois.custoEnergiaCents).toBe(antes.custoEnergiaCents);
	});

	it('lista vazia não escreve nada e devolve zero', () => {
		gravar('a');
		expect(aplicarFinalidadeEmLote(ctx.db, [], 'homelab')).toBe(0);
		expect(ctx.db.select().from(schema.impressao).all()[0].finalidade).toBe('outro');
	});

	it('id inexistente não é erro — conta as que existem', () => {
		const a = gravar('a');
		expect(aplicarFinalidadeEmLote(ctx.db, [a.id, 99_999], 'pessoal')).toBe(1);
	});

	it('aguenta uma lista grande de ids sem virar exceção', () => {
		// A varredura vai em blocos, como `idsJaImportados` já fazia — o teto de
		// variáveis por statement do SQLite é a razão, e ele varia com o build.
		// Este teste prova o resultado (nada explode, e só a linha real conta);
		// o tamanho do bloco em si é defesa, não comportamento observável.
		const ids = Array.from({ length: 1200 }, (_, i) => i + 1);
		const a = gravar('a');
		expect(aplicarFinalidadeEmLote(ctx.db, ids, 'estudio')).toBe(1);
		expect(ctx.db.select().from(schema.impressao).all()[0].finalidade).toBe('estudio');
		expect(a.id).toBeGreaterThan(0);
	});
});
