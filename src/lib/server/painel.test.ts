import { describe, expect, it } from 'vitest';
import { resumoDoPeriodo, type ImpressaoResumo } from './painel';

const DIA = 86_400_000;
const T0 = 1_754_700_000_000;

const dados: ImpressaoResumo[] = [
	{ inicioEm: T0, gramas: 149, duracaoS: 12960, status: 'sucesso', custoTotalCents: 2000, finalidade: 'estudio' },
	{ inicioEm: T0 + DIA, gramas: 179, duracaoS: 16200, status: 'sucesso', custoTotalCents: 2400, finalidade: 'homelab' },
	{ inicioEm: T0 + 2 * DIA, gramas: 30, duracaoS: 1800, status: 'falha', custoTotalCents: 400, finalidade: 'estudio' },
	{ inicioEm: T0 - 30 * DIA, gramas: 999, duracaoS: 99999, status: 'sucesso', custoTotalCents: 9999, finalidade: 'outro' }
];

describe('resumoDoPeriodo', () => {
	it('ignora o que está fora da janela', () => {
		const r = resumoDoPeriodo(dados, T0, T0 + 3 * DIA);
		expect(r.totalImpressoes).toBe(3);
	});

	it('soma gramas e horas do período', () => {
		const r = resumoDoPeriodo(dados, T0, T0 + 3 * DIA);
		expect(r.gramas).toBe(358);
		expect(r.horas).toBeCloseTo(8.6, 1);
	});

	it('separa o desperdício das falhas', () => {
		const r = resumoDoPeriodo(dados, T0, T0 + 3 * DIA);
		expect(r.gramasDesperdicadas).toBe(30);
		expect(r.custoDesperdicadoCents).toBe(400);
	});

	it('calcula taxa de sucesso', () => {
		const r = resumoDoPeriodo(dados, T0, T0 + 3 * DIA);
		expect(r.taxaSucesso).toBeCloseTo(2 / 3);
	});

	it('agrupa gasto por finalidade', () => {
		const r = resumoDoPeriodo(dados, T0, T0 + 3 * DIA);
		expect(r.porFinalidade.estudio).toBe(2400);
		expect(r.porFinalidade.homelab).toBe(2400);
	});

	it('devolve zeros em período vazio sem quebrar', () => {
		const r = resumoDoPeriodo([], T0, T0 + DIA);
		expect(r.totalImpressoes).toBe(0);
		expect(r.taxaSucesso).toBe(0);
	});

	// Teste de borda dedicado: os quatro registros de `dados` já cobrem o
	// início da janela (T0 cai exatamente em inicioEm), mas nenhum deles cai
	// exatamente no fim. Sem este teste, trocar o `<=` do fim por `<` no
	// filtro passaria pela suíte inteira sem quebrar nada — o mesmo defeito
	// de "teste de borda que não discrimina" que já apareceu duas vezes neste
	// projeto.
	it('inclui o que cai exatamente no início e no fim da janela', () => {
		const bordas: ImpressaoResumo[] = [
			{
				inicioEm: T0,
				gramas: 10,
				duracaoS: 100,
				status: 'sucesso',
				custoTotalCents: 100,
				finalidade: 'outro'
			},
			{
				inicioEm: T0 + 3 * DIA,
				gramas: 20,
				duracaoS: 100,
				status: 'sucesso',
				custoTotalCents: 100,
				finalidade: 'outro'
			}
		];

		const r = resumoDoPeriodo(bordas, T0, T0 + 3 * DIA);
		expect(r.totalImpressoes).toBe(2);
	});
});

describe('resumoDoPeriodo com rateio de falhas', () => {
	const janela = [T0, T0 + 3 * DIA] as const;

	it('desligado, mantém a falha no próprio balde de finalidade', () => {
		const r = resumoDoPeriodo(dados, ...janela, { rateioFalhas: false });
		expect(r.rateioAtivo).toBe(false);
		expect(r.fatorDesperdicio).toBe(1);
		// 2000 do sucesso de estúdio + 400 da falha de estúdio.
		expect(r.porFinalidade.estudio).toBe(2400);
		expect(r.porFinalidade.homelab).toBe(2400);
	});

	it('ligado, redistribui o desperdício sobre as finalidades que deram certo', () => {
		const r = resumoDoPeriodo(dados, ...janela, { rateioFalhas: true });
		expect(r.rateioAtivo).toBe(true);
		// 4800 gastos no total / 4400 que viraram peça.
		expect(r.fatorDesperdicio).toBeCloseTo(4800 / 4400, 6);
		expect(r.porFinalidade.estudio).toBe(2182); // 2000 × 1,0909…
		expect(r.porFinalidade.homelab).toBe(2618); // 2400 × 1,0909…
	});

	it('preserva o total do período: os baldes rateados somam custoTotalCents', () => {
		const r = resumoDoPeriodo(dados, ...janela, { rateioFalhas: true });
		const soma = Object.values(r.porFinalidade).reduce((a, b) => a + b, 0);
		expect(soma).toBe(r.custoTotalCents);
		expect(soma).toBe(4800);
	});

	// Caso construído pra que os arredondamentos NÃO fechem sozinhos: dois
	// baldes de 1000 e 1 centavo de desperdício dão 1000,5 cada, que arredonda
	// pra 1001 nos dois — 2002 contra um total de 2001. Sem o acerto do
	// resíduo, o painel mostra um centavo que não existe.
	it('acerta o resíduo do arredondamento no maior balde', () => {
		const empate: ImpressaoResumo[] = [
			{ inicioEm: T0, gramas: 10, duracaoS: 3600, status: 'sucesso', custoTotalCents: 1000, finalidade: 'estudio' },
			{ inicioEm: T0, gramas: 10, duracaoS: 3600, status: 'sucesso', custoTotalCents: 1000, finalidade: 'homelab' },
			{ inicioEm: T0, gramas: 1, duracaoS: 10, status: 'falha', custoTotalCents: 1, finalidade: 'pessoal' }
		];
		const r = resumoDoPeriodo(empate, ...janela, { rateioFalhas: true });
		expect(r.porFinalidade).toEqual({ estudio: 1000, homelab: 1001 });
		expect(Object.values(r.porFinalidade).reduce((a, b) => a + b, 0)).toBe(2001);
	});

	// O caso acima empata os baldes, então não diz NADA sobre qual deles recebe
	// o resíduo. Aqui os três são diferentes e o resíduo (+1) só pode cair no
	// maior: se caísse no primeiro, estudio viraria 102.
	it('joga o resíduo no maior balde, não no primeiro', () => {
		const desiguais: ImpressaoResumo[] = [
			{ inicioEm: T0, gramas: 1, duracaoS: 60, status: 'sucesso', custoTotalCents: 101, finalidade: 'estudio' },
			{ inicioEm: T0, gramas: 1, duracaoS: 60, status: 'sucesso', custoTotalCents: 100, finalidade: 'homelab' },
			{ inicioEm: T0, gramas: 2, duracaoS: 60, status: 'sucesso', custoTotalCents: 200, finalidade: 'pessoal' },
			{ inicioEm: T0, gramas: 1, duracaoS: 10, status: 'falha', custoTotalCents: 1, finalidade: 'outro' }
		];
		const r = resumoDoPeriodo(desiguais, ...janela, { rateioFalhas: true });
		expect(r.porFinalidade).toEqual({ estudio: 101, homelab: 100, pessoal: 201 });
		expect(Object.values(r.porFinalidade).reduce((a, b) => a + b, 0)).toBe(402);
	});

	it('sem falhas no período, o rateio ligado não muda nada', () => {
		const soSucesso = dados.filter((i) => i.status === 'sucesso');
		const r = resumoDoPeriodo(soSucesso, ...janela, { rateioFalhas: true });
		expect(r.fatorDesperdicio).toBe(1);
		expect(r.porFinalidade).toEqual({ estudio: 2000, homelab: 2400 });
	});

	// Período em que TUDO falhou não tem sobre o que ratear. Zerar os baldes
	// (ou dividir por zero) sumiria com o gasto do período no relatório.
	it('período sem nenhum sucesso mantém o custo visível em vez de sumir com ele', () => {
		const soFalha: ImpressaoResumo[] = [
			{ inicioEm: T0, gramas: 30, duracaoS: 1800, status: 'falha', custoTotalCents: 400, finalidade: 'estudio' }
		];
		const r = resumoDoPeriodo(soFalha, ...janela, { rateioFalhas: true });
		expect(r.fatorDesperdicio).toBe(1);
		expect(r.porFinalidade).toEqual({ estudio: 400 });
		expect(r.custoTotalCents).toBe(400);
	});

	it('o desperdício continua reportado à parte mesmo com o rateio ligado', () => {
		const r = resumoDoPeriodo(dados, ...janela, { rateioFalhas: true });
		expect(r.gramasDesperdicadas).toBe(30);
		expect(r.custoDesperdicadoCents).toBe(400);
		expect(r.custoTotalCents).toBe(4800);
	});

	it('sem opções, o comportamento é o de antes (rateio desligado)', () => {
		const r = resumoDoPeriodo(dados, ...janela);
		expect(r.rateioAtivo).toBe(false);
		expect(r.porFinalidade.estudio).toBe(2400);
	});
});
