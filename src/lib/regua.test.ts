import { describe, expect, it } from 'vitest';
import { fracaoNaRegua, reguaCompartilhada } from './regua';

describe('reguaCompartilhada', () => {
	it('é o maior peso inicial da tela', () => {
		expect(reguaCompartilhada([{ pesoLiquidoInicialG: 20 }, { pesoLiquidoInicialG: 1000 }])).toBe(
			1000
		);
	});

	it('com um rolo só, é o peso dele — a leitura de hoje não muda', () => {
		expect(reguaCompartilhada([{ pesoLiquidoInicialG: 750 }])).toBe(750);
	});

	it('sem rolo nenhum, não é zero — divisão por zero é NaN na largura da barra', () => {
		expect(reguaCompartilhada([])).toBe(1);
	});

	it('ignora peso inicial corrompido em vez de adotá-lo como régua', () => {
		const rolos = [
			{ pesoLiquidoInicialG: Number.POSITIVE_INFINITY },
			{ pesoLiquidoInicialG: Number.NaN },
			{ pesoLiquidoInicialG: -500 },
			{ pesoLiquidoInicialG: 0 },
			{ pesoLiquidoInicialG: 1000 }
		];
		expect(reguaCompartilhada(rolos)).toBe(1000);
	});

	it('só com pesos corrompidos, cai no piso em vez de estourar', () => {
		expect(reguaCompartilhada([{ pesoLiquidoInicialG: 0 }])).toBe(1);
	});
});

describe('fracaoNaRegua', () => {
	it('o rolo de 6 g num régua de 1 kg desenha quase nada', () => {
		expect(fracaoNaRegua(6, 1000)).toBeCloseTo(0.006, 5);
	});

	it('o rolo com 6 g NUNCA desenha mais que o rolo com 391 g', () => {
		// Era exatamente isto que a tela fazia: 6 de 20 desenhava 30% e 391 de
		// 1000 desenhava 39%, e os dois liam como quase cheios lado a lado.
		expect(fracaoNaRegua(6, 1000)).toBeLessThan(fracaoNaRegua(391, 1000));
	});

	it('a barra cheia é a régua', () => {
		expect(fracaoNaRegua(1000, 1000)).toBe(1);
	});

	it('não passa de cheia nem fica negativa', () => {
		expect(fracaoNaRegua(1500, 1000)).toBe(1);
		expect(fracaoNaRegua(-5, 1000)).toBe(0);
	});

	it('régua inválida devolve zero, e não NaN na largura da barra', () => {
		expect(fracaoNaRegua(100, 0)).toBe(0);
		expect(fracaoNaRegua(100, Number.NaN)).toBe(0);
	});
});
