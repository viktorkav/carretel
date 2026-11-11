import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema';
import {
	TAREFA_ABORTADA,
	TAREFA_COMPRIMENTO_INCOERENTE,
	TAREFA_CONCLUIDA,
	TAREFA_MULTIFILAMENTO,
	TAREFA_SEM_FIM,
	criarTarefaBruta
} from './fixtures';
import { normalizarTarefa, type TarefaNuvem } from './parse';
import {
	candidatasDeImpressora,
	candidatosDeRolo,
	completarPlates,
	contarSemCapa,
	contarSemPlate,
	excluirImpressaoDaNuvem,
	finalidadesConhecidas,
	importarTarefas,
	marcarImportacao,
	lerEntradasDoFormulario,
	observacoesDaTarefa,
	recuperarCapas,
	separarJaImportadas
} from './importacao';

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
			apelidoBambu: 'Unit-01(A1)',
			precoCompraCents: 250_000,
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
			corHex: '#000000',
			codigoBambu: 'GFA18',
			precoPagoCents: 12_000,
			pesoLiquidoInicialG: 1000,
			status: 'aberto'
		})
		.returning()
		.all();

	return { db, impressoraId: imp.id, roloId: rol.id };
}

let ctx: ReturnType<typeof montar>;
beforeEach(() => {
	ctx = montar();
});

function entrada(tarefa: TarefaNuvem, over: Record<string, unknown> = {}) {
	return {
		tarefa,
		roloId: ctx.roloId,
		impressoraId: ctx.impressoraId,
		finalidade: 'estudio' as const,
		...over
	};
}

describe('importarTarefas', () => {
	it('grava a tarefa concluída com custo congelado', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		const r = importarTarefas(ctx.db, [entrada(t)]);

		expect(r.gravadas).toBe(1);
		const linha = ctx.db.select().from(schema.impressao).all()[0];
		expect(linha.nomeLivre).toBe('Suporte de microfone');
		expect(linha.taskIdNuvem).toBe('912345678');
		expect(linha.origem).toBe('nuvem');
		expect(linha.gramas).toBe(82.5);
		expect(linha.status).toBe('sucesso');
		expect(linha.placaBuild).toBe('textured_plate');
		expect(linha.camadaMm).toBe(0.2);
		expect(linha.paredes).toBe(2);
		expect(linha.infillPct).toBe(15);
		// 82,5 g × (12000 ¢ / 1000 g) = 990 ¢
		expect(linha.custoFilamentoCents).toBe(990);
	});

	it('grava a duração da subtração, não a estimativa do fatiamento', () => {
		// A tarefa abortada roda 12 min (720 s) e carrega costTime de 12900 s.
		// Ela abortou, então o peso é digitado — ver "peso de peça abortada".
		importarTarefas(ctx.db, [
			entrada(normalizarTarefa(TAREFA_ABORTADA)!, { gramasInformadas: 1.5 })
		]);
		const linha = ctx.db.select().from(schema.impressao).all()[0];

		expect(linha.duracaoS).toBe(720);
		expect(linha.status).toBe('falha');
		// Energia de 720 s a 100 W e 0,95 R$/kWh = 1,9 ¢ → 2 ¢.
		// Com costTime seriam 34 ¢, e a depreciação erraria por 3h23 de máquina.
		expect(linha.custoEnergiaCents).toBe(2);
		expect(linha.custoDepreciacaoCents).toBe(10);
	});

	it('é idempotente: rodar de novo não duplica', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		importarTarefas(ctx.db, [entrada(t)]);
		const segunda = importarTarefas(ctx.db, [entrada(t)]);

		expect(segunda.gravadas).toBe(0);
		expect(segunda.duplicadas).toBe(1);
		expect(ctx.db.select().from(schema.impressao).all()).toHaveLength(1);
	});

	it('não duplica nem quando a mesma tarefa aparece duas vezes no mesmo lote', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		const r = importarTarefas(ctx.db, [entrada(t), entrada(t)]);

		expect(r.gravadas).toBe(1);
		expect(r.duplicadas).toBe(1);
		expect(ctx.db.select().from(schema.impressao).all()).toHaveLength(1);
	});

	it('recusa a tarefa sem término em vez de gravar duração zero', () => {
		const r = importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_SEM_FIM)!)]);

		expect(r.gravadas).toBe(0);
		expect(r.puladas[0].motivo).toMatch(/término/i);
		expect(ctx.db.select().from(schema.impressao).all()).toHaveLength(0);
	});

	it('deixa a tarefa sem término disponível para a importação seguinte', () => {
		// Como nada foi gravado, o taskId continua livre: quando a impressão
		// terminar de verdade, a próxima importação a pega.
		importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_SEM_FIM)!)]);
		const terminada = normalizarTarefa(
			criarTarefaBruta({
				id: 912_345_680,
				startTime: '2026-08-09T22:30:00Z',
				endTime: '2026-08-09T23:30:00Z'
			})
		)!;
		const r = importarTarefas(ctx.db, [entrada(terminada)]);

		expect(r.gravadas).toBe(1);
		expect(ctx.db.select().from(schema.impressao).all()[0].duracaoS).toBe(3600);
	});

	it('pula a tarefa sem rolo atribuído — sem rolo não há custo', () => {
		const r = importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_CONCLUIDA)!, { roloId: null })]);

		expect(r.gravadas).toBe(0);
		expect(r.puladas[0].motivo).toMatch(/rolo/i);
	});

	it('pula id de rolo inexistente sem estourar', () => {
		const r = importarTarefas(ctx.db, [
			entrada(normalizarTarefa(TAREFA_CONCLUIDA)!, { roloId: 9999 })
		]);

		expect(r.gravadas).toBe(0);
		expect(r.puladas[0].motivo).toMatch(/rolo/i);
	});

	/**
	 * ── O decoy que a fusão criou ────────────────────────────────────────────
	 *
	 * `sugerirRolo` nunca oferece rolo vazio, mas o `<select>` lista todos e o
	 * formulário aceita qualquer id. Antes da fusão isso era teórico: ninguém
	 * tinha rolo vazio. Agora a própria migração fabrica um para cada filamento
	 * que não tinha rolo — com o mesmo material, a mesma cor, o mesmo
	 * `codigoBambu` e um código vizinho na lista. E como ele entra com preço
	 * zero, escolhê-lo por engano gravava `custoFilamentoCents = 0` e a tela
	 * dizia "gravada".
	 */
	function roloVazio(status: 'vazio' | 'descartado') {
		const [r] = ctx.db
			.insert(schema.rolo)
			.values({
				codigo: 'PLA-PRETO-09',
				marca: 'Bambu',
				material: 'PLA',
				cor: 'Preto',
				corHex: '#000000',
				codigoBambu: 'GFA18',
				precoPagoCents: 0,
				status
			})
			.returning()
			.all();
		return r.id;
	}

	it('recusa gravar num rolo vazio em vez de congelar custo zero', () => {
		const r = importarTarefas(ctx.db, [
			entrada(normalizarTarefa(TAREFA_CONCLUIDA)!, { roloId: roloVazio('vazio') })
		]);

		expect(r.gravadas).toBe(0);
		expect(ctx.db.select().from(schema.impressao).all()).toHaveLength(0);
		expect(r.puladas[0].motivo).toMatch(/vazio/);
		// O motivo precisa dizer o que fazer: recusar sem saída é só outro jeito
		// de perder a importação.
		expect(r.puladas[0].motivo).toMatch(/PLA-PRETO-09/);
		expect(r.puladas[0].motivo).toMatch(/status/);
	});

	it('recusa gravar num rolo descartado', () => {
		const r = importarTarefas(ctx.db, [
			entrada(normalizarTarefa(TAREFA_CONCLUIDA)!, { roloId: roloVazio('descartado') })
		]);

		expect(r.gravadas).toBe(0);
		expect(r.puladas[0].motivo).toMatch(/descartado/);
	});

	it('o rolo aberto continua entrando normalmente', () => {
		roloVazio('vazio');
		const r = importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_CONCLUIDA)!)]);
		expect(r.gravadas).toBe(1);
		expect(ctx.db.select().from(schema.impressao).all()[0].custoFilamentoCents).toBe(990);
	});

	it('pula id de impressora inexistente sem estourar', () => {
		const r = importarTarefas(ctx.db, [
			entrada(normalizarTarefa(TAREFA_CONCLUIDA)!, { impressoraId: 9999 })
		]);

		expect(r.gravadas).toBe(0);
		expect(r.puladas[0].motivo).toMatch(/impressora/i);
	});

	it('grava a peça multimaterial no rolo escolhido, com o rateio anotado', () => {
		const t = normalizarTarefa(TAREFA_MULTIFILAMENTO)!;
		importarTarefas(ctx.db, [entrada(t, { confirmado: true })]);
		const linha = ctx.db.select().from(schema.impressao).all()[0];

		// O schema tem UM rolo por impressão. O peso total vai inteiro para o
		// rolo escolhido e a divisão real fica escrita, para não sumir.
		expect(linha.gramas).toBe(120);
		expect(linha.observacoes).toMatch(/PLA/);
		expect(linha.observacoes).toMatch(/PETG/);
		expect(linha.observacoes).toMatch(/30/);
	});

	it('continua o lote quando uma tarefa falha', () => {
		const boa = normalizarTarefa(TAREFA_CONCLUIDA)!;
		const ruim = normalizarTarefa(TAREFA_SEM_FIM)!;
		const r = importarTarefas(ctx.db, [entrada(ruim), entrada(boa)]);

		expect(r.gravadas).toBe(1);
		expect(r.puladas).toHaveLength(1);
	});

	it('guarda o caminho da imagem quando ela foi baixada', () => {
		importarTarefas(ctx.db, [
			entrada(normalizarTarefa(TAREFA_CONCLUIDA)!, { imagemPath: 'nuvem/912345678.png' })
		]);
		expect(ctx.db.select().from(schema.impressao).all()[0].imagemPath).toBe(
			'nuvem/912345678.png'
		);
	});
});

describe('separarJaImportadas', () => {
	it('separa o que já está no banco do que é novo', () => {
		importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_CONCLUIDA)!)]);

		const tarefas = [
			normalizarTarefa(TAREFA_CONCLUIDA)!,
			normalizarTarefa(TAREFA_ABORTADA)!,
			normalizarTarefa(TAREFA_SEM_FIM)!
		];
		const r = separarJaImportadas(ctx.db, tarefas);

		expect(r.jaImportadas).toBe(1);
		expect(r.novas.map((t) => t.taskId)).toEqual(['912345679', '912345680']);
	});

	it('não confunde impressão manual com tarefa da nuvem', () => {
		ctx.db
			.insert(schema.impressao)
			.values({
				nomeLivre: 'manual',
				impressoraId: ctx.impressoraId,
				roloId: ctx.roloId,
				inicioEm: new Date(1_754_700_000_000),
				duracaoS: 3600,
				gramas: 10,
				origem: 'manual'
			})
			.run();

		const r = separarJaImportadas(ctx.db, [normalizarTarefa(TAREFA_CONCLUIDA)!]);
		expect(r.jaImportadas).toBe(0);
		expect(r.novas).toHaveLength(1);
	});
});

describe('candidatos do banco', () => {
	it('traz o rolo com material, cor e código — colunas do próprio rolo desde a fusão', () => {
		const [c] = candidatosDeRolo(ctx.db);
		expect(c.material).toBe('PLA');
		expect(c.corHex).toBe('#000000');
		expect(c.codigoBambu).toBe('GFA18');
		expect(c.status).toBe('aberto');
	});

	/**
	 * Depois da fusão, dois rolos com marca, material e cor iguais são o caso
	 * NORMAL — é assim que a segunda compra guarda o próprio preço. Sem o
	 * código no rótulo, o `select` da tela de importação mostraria duas opções
	 * com o texto idêntico, e escolher o rolo certo viraria adivinhação.
	 */
	it('o rótulo começa pelo código, que é o que distingue duas compras iguais', () => {
		ctx.db
			.insert(schema.rolo)
			.values({
				codigo: 'PLA-PRETO-02',
				marca: 'Bambu',
				material: 'PLA',
				cor: 'Preto',
				corHex: '#000000',
				codigoBambu: 'GFA18',
				precoPagoCents: 13_500
			})
			.run();

		const rotulos = candidatosDeRolo(ctx.db).map((c) => c.apelido);
		expect(rotulos).toEqual([
			'PLA-PRETO-01 · Bambu PLA Preto',
			'PLA-PRETO-02 · Bambu PLA Preto'
		]);
		expect(new Set(rotulos).size).toBe(2);
	});

	it('traz só as impressoras ativas, com o apelido da nuvem', () => {
		const [i] = candidatasDeImpressora(ctx.db);
		expect(i.apelidoBambu).toBe('Unit-01(A1)');

		ctx.db.update(schema.impressora).set({ ativa: false }).run();
		expect(candidatasDeImpressora(ctx.db)).toHaveLength(0);
	});
});

describe('lerEntradasDoFormulario', () => {
	const tarefas = [normalizarTarefa(TAREFA_CONCLUIDA)!, normalizarTarefa(TAREFA_ABORTADA)!];

	function formDe(pares: Record<string, string>) {
		const f = new FormData();
		for (const [k, v] of Object.entries(pares)) f.append(k, v);
		return f;
	}

	it('lê rolo e impressora por tarefa', () => {
		const entradas = lerEntradasDoFormulario(
			formDe({
				'rolo:912345678': '3',
				'impressora:912345678': '1',
				'rolo:912345679': '4',
				'impressora:912345679': '1',
				finalidade: 'homelab'
			}),
			tarefas
		);

		expect(entradas).toHaveLength(2);
		expect(entradas[0]).toMatchObject({ roloId: 3, impressoraId: 1, finalidade: 'homelab' });
		expect(entradas[1].roloId).toBe(4);
	});

	it('ignora tarefa que o formulário nem menciona', () => {
		const entradas = lerEntradasDoFormulario(formDe({ 'rolo:912345678': '3' }), tarefas);
		expect(entradas.map((e) => e.tarefa.taskId)).toEqual(['912345678']);
	});

	it('trata rolo vazio como "não importar", não como erro', () => {
		const entradas = lerEntradasDoFormulario(formDe({ 'rolo:912345678': '' }), tarefas);
		expect(entradas[0].roloId).toBeNull();
	});

	it('trata id malformado como não atribuído em vez de deixar virar 500', () => {
		for (const lixo of ['abc', '0', '-1', '1.5', 'null']) {
			const entradas = lerEntradasDoFormulario(formDe({ 'rolo:912345678': lixo }), tarefas);
			expect(entradas[0].roloId).toBeNull();
		}
	});

	it('cai em "outro" quando a finalidade não é uma das conhecidas', () => {
		const entradas = lerEntradasDoFormulario(
			formDe({ 'rolo:912345678': '1', finalidade: 'sei-la' }),
			tarefas
		);
		expect(entradas[0].finalidade).toBe('outro');
	});

	it('a finalidade da LINHA ganha da do lote', () => {
		// O achado nº 5: com um seletor só, as 11 impressões reais entraram no
		// mesmo balde e o único card de análise do painel virou uma barra de 100%.
		const entradas = lerEntradasDoFormulario(
			formDe({
				'rolo:912345678': '1',
				'finalidade:912345678': 'conteudo',
				'rolo:912345679': '1',
				finalidade: 'homelab'
			}),
			tarefas
		);
		expect(entradas[0].finalidade).toBe('conteudo');
		expect(entradas[1].finalidade).toBe('homelab');
	});

	it('linha em branco herda o lote em vez de virar "outro"', () => {
		// Sem isto, a camada de lote deixaria de funcionar assim que a tela
		// passasse a mandar um campo por linha — e sem JavaScript ela é a ÚNICA
		// que funciona.
		const entradas = lerEntradasDoFormulario(
			formDe({ 'rolo:912345678': '1', 'finalidade:912345678': '', finalidade: 'pessoal' }),
			tarefas
		);
		expect(entradas[0].finalidade).toBe('pessoal');
	});

	it('linha com lixo herda o lote em vez de derrubar a importação', () => {
		const entradas = lerEntradasDoFormulario(
			formDe({ 'rolo:912345678': '1', 'finalidade:912345678': 'drop', finalidade: 'estudio' }),
			tarefas
		);
		expect(entradas[0].finalidade).toBe('estudio');
	});

	it('duas linhas do mesmo lote podem sair com finalidades diferentes', () => {
		const entradas = lerEntradasDoFormulario(
			formDe({
				'rolo:912345678': '1',
				'finalidade:912345678': 'estudio',
				'rolo:912345679': '1',
				'finalidade:912345679': 'pessoal'
			}),
			tarefas
		);
		expect(entradas.map((e) => e.finalidade)).toEqual(['estudio', 'pessoal']);
	});
});

describe('finalidadesConhecidas', () => {
	it('lê do banco a finalidade com que aquela peça já foi impressa', () => {
		importarTarefas(ctx.db, [
			entrada(normalizarTarefa(TAREFA_CONCLUIDA)!, { finalidade: 'conteudo' })
		]);
		const historico = finalidadesConhecidas(ctx.db);
		expect(historico.get('suporte de microfone')).toBe('conteudo');
	});

	it('não aprende com o balde único — `outro` não vira sugestão', () => {
		importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_CONCLUIDA)!, { finalidade: 'outro' })]);
		expect(finalidadesConhecidas(ctx.db).size).toBe(0);
	});

	it('base vazia devolve mapa vazio, não erro', () => {
		expect(finalidadesConhecidas(ctx.db).size).toBe(0);
	});
});

describe('observacoesDaTarefa', () => {
	it('é vazia numa peça de um filamento só', () => {
		expect(observacoesDaTarefa(normalizarTarefa(TAREFA_CONCLUIDA)!)).toBeNull();
	});

	it('escreve o rateio real numa peça multimaterial', () => {
		const obs = observacoesDaTarefa(normalizarTarefa(TAREFA_MULTIFILAMENTO)!);
		expect(obs).toMatch(/PLA/);
		expect(obs).toMatch(/90/);
		expect(obs).toMatch(/PETG/);
	});
});

describe('multimaterial só entra com aceite', () => {
	it('recusa a peça de dois filamentos sem confirmação', () => {
		// Sem a trava, o probe do revisor grava 120 g no rolo de PLA: custo 1440
		// onde o certo seria 1980 (erro de 27% para menos), e os 30 g de PETG
		// nunca são debitados daquele rolo.
		const r = importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_MULTIFILAMENTO)!)]);

		expect(r.gravadas).toBe(0);
		expect(r.puladas[0].motivo).toMatch(/um rolo só/);
		expect(ctx.db.select().from(schema.impressao).all()).toHaveLength(0);
	});

	it('grava quando o usuário aceita linha a linha, com o rateio anotado', () => {
		const r = importarTarefas(ctx.db, [
			entrada(normalizarTarefa(TAREFA_MULTIFILAMENTO)!, { confirmado: true })
		]);

		expect(r.gravadas).toBe(1);
		const linha = ctx.db.select().from(schema.impressao).all()[0];
		expect(linha.gramas).toBe(120);
		expect(linha.observacoes).toMatch(/PETG/);
	});

	it('o aceite é por linha, não por lote', () => {
		const r = importarTarefas(ctx.db, [
			entrada(normalizarTarefa(TAREFA_MULTIFILAMENTO)!, { confirmado: true }),
			entrada(
				normalizarTarefa(criarTarefaBruta({ id: 7, amsDetailMapping: TAREFA_MULTIFILAMENTO.amsDetailMapping }))!
			)
		]);

		expect(r.gravadas).toBe(1);
		expect(r.puladas).toHaveLength(1);
	});

	it('lê o aceite do formulário como checkbox por tarefa', () => {
		const f = new FormData();
		f.append('rolo:912345681', '1');
		f.append('confirmar:912345681', 'on');
		const [e] = lerEntradasDoFormulario(f, [normalizarTarefa(TAREFA_MULTIFILAMENTO)!]);
		expect(e.confirmado).toBe(true);

		const g = new FormData();
		g.append('rolo:912345681', '1');
		const [e2] = lerEntradasDoFormulario(g, [normalizarTarefa(TAREFA_MULTIFILAMENTO)!]);
		expect(e2.confirmado).toBe(false);
	});
});

describe('excluirImpressaoDaNuvem', () => {
	it('libera o taskId para reimportação com o rolo certo', () => {
		// A saída para o clique errado no select de grupo: sem isso, cinquenta
		// custos errados ficam congelados e a reimportação devolve `duplicadas`.
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		importarTarefas(ctx.db, [entrada(t)]);
		const gravada = ctx.db.select().from(schema.impressao).all()[0];

		const r = excluirImpressaoDaNuvem(ctx.db, gravada.id);
		expect(r.ok).toBe(true);
		expect(ctx.db.select().from(schema.impressao).all()).toHaveLength(0);

		expect(separarJaImportadas(ctx.db, [t]).novas).toHaveLength(1);
		expect(importarTarefas(ctx.db, [entrada(t)]).gravadas).toBe(1);
	});

	it('recusa apagar impressão manual — ela não tem de onde voltar', () => {
		ctx.db
			.insert(schema.impressao)
			.values({
				nomeLivre: 'digitada à mão',
				impressoraId: ctx.impressoraId,
				roloId: ctx.roloId,
				inicioEm: new Date(1_754_700_000_000),
				duracaoS: 3600,
				gramas: 10,
				origem: 'manual'
			})
			.run();
		const manual = ctx.db.select().from(schema.impressao).all()[0];

		const r = excluirImpressaoDaNuvem(ctx.db, manual.id);
		expect(r.ok).toBe(false);
		expect(ctx.db.select().from(schema.impressao).all()).toHaveLength(1);
	});

	it('não estoura em id inexistente nem malformado', () => {
		expect(excluirImpressaoDaNuvem(ctx.db, 9999).ok).toBe(false);
		expect(excluirImpressaoDaNuvem(ctx.db, 0).ok).toBe(false);
		expect(excluirImpressaoDaNuvem(ctx.db, NaN).ok).toBe(false);
	});
});

describe('marcarImportacao', () => {
	it('carimba a data quando algo entrou', () => {
		const r = importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_CONCLUIDA)!)]);
		expect(marcarImportacao(ctx.db, r)).toBe(true);
		expect(ctx.db.select().from(schema.config).all()[0].ultimaImportacaoEm).not.toBeNull();
	});

	it('não carimba nada quando a rodada não gravou', () => {
		// Rodada só de duplicadas ou de puladas não é importação: dizer que o
		// histórico está em dia nesse caso é mentira na tela de Config.
		const r = importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_SEM_FIM)!)]);
		expect(r.gravadas).toBe(0);
		expect(marcarImportacao(ctx.db, r)).toBe(false);
		expect(ctx.db.select().from(schema.config).all()[0].ultimaImportacaoEm).toBeNull();
	});
});

describe('recuperarCapas', () => {
	/** Baixador falso: devolve caminho para todas as urls, ou para nenhuma. */
	function baixador(sucesso = true) {
		const chamadas: { taskId: string; url: string | null }[] = [];
		const fn = async (itens: { taskId: string; url: string | null }[]) => {
			chamadas.push(...itens);
			const m = new Map<string, string>();
			if (sucesso) for (const i of itens) m.set(i.taskId, `nuvem/${i.taskId}.png`);
			return m;
		};
		return { fn, chamadas };
	}

	it('preenche a capa de uma impressão que entrou sem imagem', async () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		importarTarefas(ctx.db, [entrada(t)]);
		expect(ctx.db.select().from(schema.impressao).all()[0].imagemPath).toBeNull();

		const b = baixador();
		const r = await recuperarCapas(ctx.db, [t], b.fn);

		expect(r.recuperadas).toBe(1);
		expect(ctx.db.select().from(schema.impressao).all()[0].imagemPath).toBe(
			`nuvem/${t.taskId}.png`
		);
		expect(b.chamadas).toEqual([{ taskId: t.taskId, url: t.capaUrl }]);
	});

	it('não toca em quem já tem imagem — nem gasta requisição com ela', async () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		importarTarefas(ctx.db, [entrada(t, { imagemPath: 'nuvem/antiga.png' })]);

		const b = baixador();
		const r = await recuperarCapas(ctx.db, [t], b.fn);

		expect(r.recuperadas).toBe(0);
		expect(b.chamadas).toHaveLength(0);
		expect(ctx.db.select().from(schema.impressao).all()[0].imagemPath).toBe('nuvem/antiga.png');
	});

	it('ignora impressão lançada à mão: ela nunca teve capa na nuvem', async () => {
		ctx.db
			.insert(schema.impressao)
			.values({
				nomeLivre: 'digitada à mão',
				impressoraId: ctx.impressoraId,
				roloId: ctx.roloId,
				inicioEm: new Date(1_754_700_000_000),
				duracaoS: 3600,
				gramas: 10,
				origem: 'manual'
			})
			.run();

		const b = baixador();
		const r = await recuperarCapas(ctx.db, [normalizarTarefa(TAREFA_CONCLUIDA)!], b.fn);

		expect(r.pendentes).toBe(0);
		expect(b.chamadas).toHaveLength(0);
	});

	it('conta como sem-capa-na-nuvem a tarefa que sumiu do histórico', async () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		importarTarefas(ctx.db, [entrada(t)]);

		// A busca não trouxe essa tarefa (histórico da nuvem tem teto de 500).
		const b = baixador();
		const r = await recuperarCapas(ctx.db, [], b.fn);

		expect(r.pendentes).toBe(1);
		expect(r.semCapaNaNuvem).toBe(1);
		expect(r.recuperadas).toBe(0);
		expect(b.chamadas).toHaveLength(0);
	});

	it('conta como sem-capa-na-nuvem a tarefa que veio sem cover', async () => {
		const bruta = criarTarefaBruta({ cover: null });
		const t = normalizarTarefa(bruta)!;
		importarTarefas(ctx.db, [entrada(t)]);

		const b = baixador();
		const r = await recuperarCapas(ctx.db, [t], b.fn);

		expect(r.semCapaNaNuvem).toBe(1);
		expect(b.chamadas).toHaveLength(0);
	});

	it('cada capa vai para a SUA impressão, e só para ela', async () => {
		// Duas pendentes, uma capa baixada. Se o update escrevesse sem `where`, ou
		// casasse por posição em vez de por `taskIdNuvem`, a foto de uma peça
		// apareceria na outra — erro que ninguém percebe olhando a lista.
		const a = normalizarTarefa(TAREFA_CONCLUIDA)!;
		const b = normalizarTarefa(criarTarefaBruta({ designTitle: 'Outra peça' }))!;
		importarTarefas(ctx.db, [entrada(a), entrada(b)]);

		const so_a = async () => new Map([[a.taskId, `nuvem/${a.taskId}.png`]]);
		const r = await recuperarCapas(ctx.db, [a, b], so_a);

		expect(r.recuperadas).toBe(1);
		expect(r.falharam).toBe(1);
		const linhas = ctx.db.select().from(schema.impressao).all();
		const daA = linhas.find((l) => l.taskIdNuvem === a.taskId)!;
		const daB = linhas.find((l) => l.taskIdNuvem === b.taskId)!;
		expect(daA.imagemPath).toBe(`nuvem/${a.taskId}.png`);
		expect(daB.imagemPath).toBeNull();
	});

	it('conta o download que falhou sem escrever nada no banco', async () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		importarTarefas(ctx.db, [entrada(t)]);

		const b = baixador(false);
		const r = await recuperarCapas(ctx.db, [t], b.fn);

		expect(r.recuperadas).toBe(0);
		expect(r.falharam).toBe(1);
		expect(ctx.db.select().from(schema.impressao).all()[0].imagemPath).toBeNull();
	});

	it('não estoura quando o baixador cai — recuperar capa é anexo, como importar', async () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		importarTarefas(ctx.db, [entrada(t)]);

		const explode = async () => {
			throw new Error('ECONNRESET');
		};
		const r = await recuperarCapas(ctx.db, [t], explode);

		expect(r.recuperadas).toBe(0);
		expect(r.falharam).toBe(1);
	});
});

describe('contarSemCapa', () => {
	it('conta só as vindas da nuvem que estão sem imagem', async () => {
		importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_CONCLUIDA)!)]);
		importarTarefas(ctx.db, [
			entrada(normalizarTarefa(criarTarefaBruta())!, { imagemPath: 'nuvem/x.png' })
		]);
		ctx.db
			.insert(schema.impressao)
			.values({
				nomeLivre: 'à mão',
				impressoraId: ctx.impressoraId,
				roloId: ctx.roloId,
				inicioEm: new Date(1_754_700_000_000),
				duracaoS: 60,
				gramas: 1,
				origem: 'manual'
			})
			.run();

		expect(contarSemCapa(ctx.db)).toBe(1);
	});
});

// ── item 2 da crítica: o peso da nuvem é estimativa, não medição ────────────

describe('importarTarefas — peso de peça que abortou', () => {
	const abortada = () => normalizarTarefa(TAREFA_ABORTADA)!;

	it('recusa a tarefa abortada quando ninguém digitou o peso', () => {
		const r = importarTarefas(ctx.db, [entrada(abortada())]);

		expect(r.gravadas).toBe(0);
		expect(r.puladas).toHaveLength(1);
		expect(r.puladas[0].motivo).toMatch(/estimativa cheia/);
		expect(ctx.db.select().from(schema.impressao).all()).toHaveLength(0);
	});

	it('grava o peso digitado, e não o da nuvem', () => {
		const r = importarTarefas(ctx.db, [entrada(abortada(), { gramasInformadas: 0.4 })]);

		expect(r.gravadas).toBe(1);
		expect(r.comPesoDigitado).toBe(1);
		const linha = ctx.db.select().from(schema.impressao).all()[0];
		expect(linha.gramas).toBe(0.4);
		expect(linha.status).toBe('falha');
	});

	it('a nota da impressão registra os dois números', () => {
		importarTarefas(ctx.db, [entrada(abortada(), { gramasInformadas: 0.4 })]);
		const linha = ctx.db.select().from(schema.impressao).all()[0];

		expect(linha.observacoes).toMatch(/abortou/);
		expect(linha.observacoes).toContain('4.2 g');
		expect(linha.observacoes).toContain('0.4 g');
	});

	it('o caso do relatório: 3 min de 5 h não debitam 202,67 g do rolo', () => {
		const t = normalizarTarefa(
			criarTarefaBruta({
				id: 555,
				status: 3,
				startTime: '2026-08-09T10:00:00Z',
				endTime: '2026-08-09T10:03:00Z',
				costTime: 18_000,
				weight: 202.67
			})
		)!;
		importarTarefas(ctx.db, [entrada(t, { gramasInformadas: 2 })]);

		const linha = ctx.db.select().from(schema.impressao).all()[0];
		expect(linha.gramas).toBe(2);
		// 202,67 g de um rolo de 1000 g a 120,00 seriam 2432 ¢ congelados.
		expect(linha.custoFilamentoCents).toBe(24);
	});

	it('peso digitado zerado ou negativo não passa por "digitado"', () => {
		const zero = importarTarefas(ctx.db, [entrada(abortada(), { gramasInformadas: null })]);
		expect(zero.gravadas).toBe(0);
	});

	it('a peça que terminou bem continua entrando sem pedir nada', () => {
		const r = importarTarefas(ctx.db, [entrada(normalizarTarefa(TAREFA_CONCLUIDA)!)]);
		expect(r.gravadas).toBe(1);
		expect(r.comPesoDigitado).toBe(0);
	});
});

// ── item 3 da crítica: gramas pela densidade do rolo ────────────────────────

describe('importarTarefas — peso pela densidade do rolo', () => {
	/** Um rolo com densidade diferente da que o perfil de fatiamento usou. */
	function roloDenso(densidade: number) {
		const [r] = ctx.db
			.insert(schema.rolo)
			.values({
				codigo: `PLA-DENSO-${Math.round(densidade * 100)}`,
				marca: 'Bambu',
				material: 'PLA',
				cor: 'Preto',
				densidade,
				precoPagoCents: 12_000,
				pesoLiquidoInicialG: 1000,
				status: 'aberto'
			})
			.returning()
			.all();
		return r.id;
	}

	it('reescreve as gramas quando o rolo é mais denso que o perfil', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		const r = importarTarefas(ctx.db, [entrada(t, { roloId: roloDenso(1.31) })]);

		expect(r.recalculadasPorDensidade).toBe(1);
		const linha = ctx.db.select().from(schema.impressao).all()[0];
		expect(linha.gramas).toBeCloseTo(82.5 * (1.31 / 1.24), 1);
		expect(linha.gramas).toBeGreaterThan(82.5);
	});

	it('o custo congelado sai do peso corrigido, não do da nuvem', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		importarTarefas(ctx.db, [entrada(t, { roloId: roloDenso(1.31) })]);
		const linha = ctx.db.select().from(schema.impressao).all()[0];

		// 12000 ¢ / 1000 g = 12 ¢/g. Com 82,5 g seriam 990 ¢.
		expect(linha.custoFilamentoCents).toBeGreaterThan(990);
		expect(linha.custoFilamentoCents).toBe(Math.round(linha.gramas * 12));
	});

	it('escreve na impressão de onde veio o peso', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		importarTarefas(ctx.db, [entrada(t, { roloId: roloDenso(1.31) })]);
		const linha = ctx.db.select().from(schema.impressao).all()[0];

		expect(linha.observacoes).toMatch(/recalculado pelo comprimento/);
	});

	it('não mexe quando o perfil já usou a densidade do rolo', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		const r = importarTarefas(ctx.db, [entrada(t, { roloId: roloDenso(1.24) })]);

		expect(r.recalculadasPorDensidade).toBe(0);
		expect(ctx.db.select().from(schema.impressao).all()[0].gramas).toBe(82.5);
	});

	it('mantém o peso da nuvem quando a tarefa não trouxe comprimento', () => {
		const t = normalizarTarefa(criarTarefaBruta({ id: 777, length: null }))!;
		const r = importarTarefas(ctx.db, [entrada(t, { roloId: roloDenso(1.31) })]);

		expect(r.gravadas).toBe(1);
		expect(r.recalculadasPorDensidade).toBe(0);
		expect(ctx.db.select().from(schema.impressao).all()[0].gramas).toBe(82.5);
	});

	it('recusa a correção quando peso e comprimento não fecham', () => {
		const t = normalizarTarefa(TAREFA_COMPRIMENTO_INCOERENTE)!;
		const r = importarTarefas(ctx.db, [entrada(t, { roloId: roloDenso(1.31) })]);

		expect(r.gravadas).toBe(1);
		expect(r.recalculadasPorDensidade).toBe(0);
		// O que NÃO pode acontecer: 82,5 g virarem 869 g por erro de unidade.
		expect(ctx.db.select().from(schema.impressao).all()[0].gramas).toBe(82.5);
	});

	it('o total de gramas do resultado é o que foi mesmo debitado', () => {
		const t = normalizarTarefa(TAREFA_CONCLUIDA)!;
		const r = importarTarefas(ctx.db, [entrada(t, { roloId: roloDenso(1.31) })]);
		const linha = ctx.db.select().from(schema.impressao).all()[0];

		expect(r.gramas).toBe(linha.gramas);
	});
});

describe('lerEntradasDoFormulario — peso digitado na linha', () => {
	const tarefas = [normalizarTarefa(TAREFA_ABORTADA)!];

	function formDe(pares: Record<string, string>) {
		const f = new FormData();
		for (const [k, v] of Object.entries(pares)) f.append(k, v);
		return f;
	}

	it('lê o peso da linha, aceitando vírgula decimal', () => {
		const [e] = lerEntradasDoFormulario(
			formDe({ 'rolo:912345679': '1', 'gramas:912345679': '1,5' }),
			tarefas
		);
		expect(e.gramasInformadas).toBe(1.5);
	});

	it('campo em branco vira null, e não zero', () => {
		const [e] = lerEntradasDoFormulario(
			formDe({ 'rolo:912345679': '1', 'gramas:912345679': '' }),
			tarefas
		);
		expect(e.gramasInformadas).toBeNull();
	});

	it('lixo digitado vira null, e não passa como número', () => {
		const [e] = lerEntradasDoFormulario(
			formDe({ 'rolo:912345679': '1', 'gramas:912345679': 'umas gramas' }),
			tarefas
		);
		expect(e.gramasInformadas).toBeNull();
	});

	it('zero e negativo não viram peso', () => {
		const zero = lerEntradasDoFormulario(
			formDe({ 'rolo:912345679': '1', 'gramas:912345679': '0' }),
			tarefas
		);
		expect(zero[0].gramasInformadas).toBeNull();

		const negativo = lerEntradasDoFormulario(
			formDe({ 'rolo:912345679': '1', 'gramas:912345679': '-3' }),
			tarefas
		);
		expect(negativo[0].gramasInformadas).toBeNull();
	});

	it('campo ausente é "a tela não perguntou", e não erro do usuário', () => {
		const [e] = lerEntradasDoFormulario(formDe({ 'rolo:912345679': '1' }), tarefas);
		expect(e.gramasInformadas).toBeUndefined();
	});
});

describe('importarTarefas — a plate e o projeto entram junto', () => {
	it('grava o índice da plate e o identificador do projeto', () => {
		const t = normalizarTarefa(criarTarefaBruta({ plateIndex: 2, designId: 4_477_881 }))!;
		importarTarefas(ctx.db, [entrada(t)]);

		const linha = ctx.db.select().from(schema.impressao).all()[0];
		expect(linha.indicePlate).toBe(2);
		expect(linha.projetoIdNuvem).toBe('4477881');
	});

	it('arquivo do próprio usuário entra sem projeto, e não com o projeto zero', () => {
		const t = normalizarTarefa(criarTarefaBruta({ designId: 0, plateIndex: 1 }))!;
		importarTarefas(ctx.db, [entrada(t)]);

		const linha = ctx.db.select().from(schema.impressao).all()[0];
		expect(linha.projetoIdNuvem).toBeNull();
		expect(linha.indicePlate).toBe(1);
	});

	it('nuvem sem os dois campos grava a impressão assim mesmo, com NULL nos dois', () => {
		const t = normalizarTarefa(criarTarefaBruta({ plateIndex: null, designId: null }))!;
		const r = importarTarefas(ctx.db, [entrada(t)]);

		expect(r.gravadas).toBe(1);
		const linha = ctx.db.select().from(schema.impressao).all()[0];
		expect(linha.indicePlate).toBeNull();
		expect(linha.projetoIdNuvem).toBeNull();
	});
});

describe('contarSemPlate', () => {
	it('conta as importadas que ainda não têm os dois campos', () => {
		importarTarefas(ctx.db, [
			entrada(normalizarTarefa(criarTarefaBruta({ id: 1, plateIndex: null, designId: null }))!),
			entrada(normalizarTarefa(criarTarefaBruta({ id: 2, plateIndex: 2, designId: 77 }))!)
		]);
		expect(contarSemPlate(ctx.db)).toBe(1);
	});

	it('linha com um dos dois preenchido continua pendente', () => {
		// Arquivo do próprio dono: projeto nunca vem. Ela conta como pendente
		// porque o índice ainda pode chegar — e a ação declara isso na tela.
		importarTarefas(ctx.db, [
			entrada(normalizarTarefa(criarTarefaBruta({ plateIndex: 2, designId: 0 }))!)
		]);
		expect(contarSemPlate(ctx.db)).toBe(1);
	});

	it('impressão digitada à mão nunca é pendente — ela não veio da nuvem', () => {
		ctx.db
			.insert(schema.impressao)
			.values({
				nomeLivre: 'digitada à mão',
				impressoraId: ctx.impressoraId,
				roloId: ctx.roloId,
				inicioEm: new Date(1_754_700_000_000),
				duracaoS: 3600,
				gramas: 10,
				origem: 'manual'
			})
			.run();
		expect(contarSemPlate(ctx.db)).toBe(0);
	});
});

describe('completarPlates — preenche o vazio, e SÓ o vazio', () => {
	/** A linha inteira, como o banco a guarda. */
	const linhas = () => ctx.db.select().from(schema.impressao).all();

	it('preenche as duas colunas de uma impressão já importada', () => {
		const bruta = criarTarefaBruta({ plateIndex: 3, designId: 4_477_881 });
		// Entrou pelo caminho antigo: o parser não lia os campos.
		const antiga = { ...normalizarTarefa(bruta)!, indicePlate: null, projetoId: null };
		importarTarefas(ctx.db, [entrada(antiga)]);
		expect(linhas()[0].indicePlate).toBeNull();

		const r = completarPlates(ctx.db, [normalizarTarefa(bruta)!]);

		expect(r).toMatchObject({ pendentes: 1, completadas: 1, indices: 1, projetos: 1 });
		expect(linhas()[0].indicePlate).toBe(3);
		expect(linhas()[0].projetoIdNuvem).toBe('4477881');
	});

	it('⚠️ não toca em custo congelado, rolo, finalidade, gramas nem duração', () => {
		const bruta = criarTarefaBruta({ plateIndex: 3, designId: 4_477_881 });
		const antiga = { ...normalizarTarefa(bruta)!, indicePlate: null, projetoId: null };
		importarTarefas(ctx.db, [entrada(antiga)]);

		// O dono ajustou a linha à mão depois de importar: outro rolo, outra
		// finalidade, outro peso, outra duração, e o custo ficou congelado como
		// estava. Completar a plate não pode desfazer nada disso.
		const [outroRolo] = ctx.db
			.insert(schema.rolo)
			.values({ codigo: 'PLA-AZUL-01', marca: 'Voolt', material: 'PLA', cor: 'Azul' })
			.returning()
			.all();
		ctx.db
			.update(schema.impressao)
			.set({
				roloId: outroRolo.id,
				finalidade: 'pessoal',
				gramas: 41.3,
				duracaoS: 999,
				observacoes: 'pesei na balança',
				custoFilamentoCents: 123,
				custoTotalCents: 456
			})
			.run();

		const antes = linhas()[0];
		completarPlates(ctx.db, [normalizarTarefa(bruta)!]);
		const depois = linhas()[0];

		// Campo a campo: só as duas colunas novas podem ter mudado.
		const semPlate = (l: typeof antes) => {
			const { indicePlate, projetoIdNuvem, ...resto } = l;
			void indicePlate;
			void projetoIdNuvem;
			return resto;
		};
		expect(semPlate(depois)).toEqual(semPlate(antes));
		expect(depois.indicePlate).toBe(3);
	});

	it('não sobrescreve o que já está preenchido, nem quando a nuvem diz outra coisa', () => {
		const bruta = criarTarefaBruta({ plateIndex: 2, designId: 111 });
		importarTarefas(ctx.db, [entrada(normalizarTarefa(bruta)!)]);

		// A nuvem agora diz plate 9, projeto 999. A linha já tem valor: fica.
		const outra = normalizarTarefa({ ...bruta, plateIndex: 9, designId: 999 })!;
		const r = completarPlates(ctx.db, [outra]);

		expect(r.completadas).toBe(0);
		expect(r.pendentes).toBe(0);
		expect(linhas()[0].indicePlate).toBe(2);
		expect(linhas()[0].projetoIdNuvem).toBe('111');
	});

	it('preenche só o campo que falta, deixando o outro como está', () => {
		const bruta = criarTarefaBruta({ plateIndex: 2, designId: 111 });
		const meia = { ...normalizarTarefa(bruta)!, projetoId: null };
		importarTarefas(ctx.db, [entrada(meia)]);
		expect(linhas()[0].indicePlate).toBe(2);
		expect(linhas()[0].projetoIdNuvem).toBeNull();

		const r = completarPlates(ctx.db, [normalizarTarefa({ ...bruta, plateIndex: 9 })!]);

		expect(r).toMatchObject({ completadas: 1, indices: 0, projetos: 1 });
		expect(linhas()[0].indicePlate).toBe(2);
		expect(linhas()[0].projetoIdNuvem).toBe('111');
	});

	it('a tarefa que sumiu do histórico é contada, não inventada', () => {
		const t = { ...normalizarTarefa(TAREFA_CONCLUIDA)!, indicePlate: null, projetoId: null };
		importarTarefas(ctx.db, [entrada(t)]);

		const r = completarPlates(ctx.db, []);

		expect(r).toMatchObject({ pendentes: 1, completadas: 0, semTarefaNaNuvem: 1 });
		expect(linhas()[0].indicePlate).toBeNull();
	});

	it('tarefa que a nuvem manda sem os campos conta como "a nuvem também não sabe"', () => {
		const bruta = criarTarefaBruta({ plateIndex: null, designId: 0 });
		importarTarefas(ctx.db, [entrada(normalizarTarefa(bruta)!)]);

		const r = completarPlates(ctx.db, [normalizarTarefa(bruta)!]);

		expect(r).toMatchObject({ pendentes: 1, completadas: 0, semDadoNaNuvem: 1 });
	});

	it('cada campo vai para a SUA impressão, casando por taskIdNuvem', () => {
		const a = criarTarefaBruta({ id: 111, plateIndex: 1, designId: 500 });
		const b = criarTarefaBruta({ id: 222, plateIndex: 7, designId: 500 });
		const semPlate = (bruta: Record<string, unknown>) => ({
			...normalizarTarefa(bruta)!,
			indicePlate: null,
			projetoId: null
		});
		importarTarefas(ctx.db, [entrada(semPlate(a)), entrada(semPlate(b))]);

		// De propósito fora de ordem: casar por posição erraria as duas.
		completarPlates(ctx.db, [normalizarTarefa(b)!, normalizarTarefa(a)!]);

		const porTask = new Map(linhas().map((l) => [l.taskIdNuvem, l.indicePlate]));
		expect(porTask.get('111')).toBe(1);
		expect(porTask.get('222')).toBe(7);
	});

	it('não encosta em impressão digitada à mão', () => {
		ctx.db
			.insert(schema.impressao)
			.values({
				nomeLivre: 'digitada à mão',
				impressoraId: ctx.impressoraId,
				roloId: ctx.roloId,
				inicioEm: new Date(1_754_700_000_000),
				duracaoS: 3600,
				gramas: 10,
				origem: 'manual'
			})
			.run();

		const r = completarPlates(ctx.db, [normalizarTarefa(criarTarefaBruta({ plateIndex: 5 }))!]);

		expect(r.pendentes).toBe(0);
		expect(linhas()[0].indicePlate).toBeNull();
	});

	it('rodar duas vezes não muda nada na segunda', () => {
		const bruta = criarTarefaBruta({ plateIndex: 3, designId: 4_477_881 });
		importarTarefas(ctx.db, [
			entrada({ ...normalizarTarefa(bruta)!, indicePlate: null, projetoId: null })
		]);

		completarPlates(ctx.db, [normalizarTarefa(bruta)!]);
		const depoisDaPrimeira = linhas();
		const r = completarPlates(ctx.db, [normalizarTarefa(bruta)!]);

		expect(r).toMatchObject({ pendentes: 0, completadas: 0 });
		expect(linhas()).toEqual(depoisDaPrimeira);
	});

	it('banco sem nenhuma pendência devolve zeros sem escrever nada', () => {
		expect(completarPlates(ctx.db, [normalizarTarefa(TAREFA_CONCLUIDA)!])).toEqual({
			pendentes: 0,
			completadas: 0,
			indices: 0,
			projetos: 0,
			semTarefaNaNuvem: 0,
			semDadoNaNuvem: 0
		});
	});
});
