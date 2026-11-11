import { describe, expect, it } from 'vitest';
import { calcularCusto, type EntradaCusto } from './custo';

const base: EntradaCusto = {
	gramas: 100,
	duracaoS: 3600,
	rolo: { precoPagoCents: 12000, pesoLiquidoInicialG: 1000 },
	impressora: { precoCompraCents: 250000, vidaUtilHoras: 5000, potenciaMediaW: 100 },
	tarifaKwhCents: 95,
	manutencao: { totalCents: 0, horasAcumuladas: 0 }
};

describe('calcularCusto', () => {
	it('cobra o filamento pelo preço do rolo que foi usado', () => {
		// 12000 centavos / 1000 g = 12 centavos por grama; 100 g = 1200
		expect(calcularCusto(base).filamentoCents).toBe(1200);
	});

	it('cobra energia pelas horas reais', () => {
		// 1 h × 0,1 kW × 95 centavos = 9,5 -> 10
		expect(calcularCusto(base).energiaCents).toBe(10);
	});

	it('deprecia a impressora por hora de uso', () => {
		// 250000 / 5000 h = 50 centavos por hora
		expect(calcularCusto(base).depreciacaoCents).toBe(50);
	});

	it('dilui manutenção pelas horas já rodadas', () => {
		const e = { ...base, manutencao: { totalCents: 3000, horasAcumuladas: 100 } };
		// 3000 / 100 h = 30 centavos por hora
		expect(calcularCusto(e).manutencaoCents).toBe(30);
	});

	it('soma o total a partir das parcelas já arredondadas', () => {
		const c = calcularCusto(base);
		expect(c.totalCents).toBe(
			c.filamentoCents + c.energiaCents + c.depreciacaoCents + c.manutencaoCents
		);
	});

	it('não divide por zero quando o rolo não tem peso cadastrado', () => {
		const e = { ...base, rolo: { precoPagoCents: 12000, pesoLiquidoInicialG: 0 } };
		expect(calcularCusto(e).filamentoCents).toBe(0);
	});

	it('não divide por zero quando a impressora não tem vida útil', () => {
		const e = {
			...base,
			impressora: { ...base.impressora, vidaUtilHoras: 0 }
		};
		expect(calcularCusto(e).depreciacaoCents).toBe(0);
	});

	it('não cobra manutenção antes da primeira hora registrada', () => {
		const e = { ...base, manutencao: { totalCents: 3000, horasAcumuladas: 0 } };
		expect(calcularCusto(e).manutencaoCents).toBe(0);
	});

	it('trata impressão de zero grama sem quebrar', () => {
		const e = { ...base, gramas: 0, duracaoS: 0 };
		expect(calcularCusto(e).totalCents).toBe(0);
	});

	it('protege contra regressão: soma das parcelas arredondadas ≠ arredondamento da soma', () => {
		// Contrói entrada em que duas parcelas somam > 0,5 fracionária
		// filamentoCents: 400 gramas × 0,4 centavos/g = 160,0 (inteiro)
		// energiaCents: 1h × 0,1kW × 95 c/kWh = 9,5 centavos → 10 (arred. para cima)
		// depreciacaoCents: 1h × 60 c/h = 60,0 (inteiro)
		// manutencaoCents: 1h × 30 c/h = 30,0 → mas vamos forçar 29,4 (30 arredondado, mas... vamos mexer em horas)
		// Estratégia: usar duracaoS que gera partes fracionárias em energia E depreciação
		// duracaoS = 4320 segundos = 1.2 horas
		// energiaCents: 1.2 × 0.1 × 95 = 11,4 → 11
		// depreciacaoCents: 1.2 × 50 = 60,0
		// manutencaoCents: 1.2 × 30 = 36,0
		// Ainda não divergem. Preciso de DUAS parcelas com .4+.4 ou .6+.6
		// Vou usar: rolo + impressora com valores específicos
		const e = {
			gramas: 1,
			duracaoS: 3600, // 1 hora
			rolo: { precoPagoCents: 1404, pesoLiquidoInicialG: 1000 }, // 1.404 c/g, 1g = 1.404 → 1
			impressora: { precoCompraCents: 404, vidaUtilHoras: 1, potenciaMediaW: 100 }, // 404 c/h → 404
			tarifaKwhCents: 404, // 1h × 0.1 × 404 = 40.4 → 40
			manutencao: { totalCents: 404, horasAcumuladas: 10 } // 40.4 c/h, 1h = 40.4 → 40
		};
		const c = calcularCusto(e);
		// filamentoCents = round(1 × 1.404) = round(1.404) = 1
		// energiaCents = round(1 × 0.1 × 404) = round(40.4) = 40
		// depreciacaoCents = round(1 × 404) = 404
		// manutencaoCents = round(1 × 40.4) = round(40.4) = 40
		// Total = 1 + 40 + 404 + 40 = 485
		// Soma bruta = 1.404 + 40.4 + 404 + 40.4 = 485.804 → round = 486
		// Teste garante: totalCents DEVE ser 485 (soma dos arredondados), não 486
		expect(c.totalCents).toBe(485);
		expect(c.totalCents).toBe(c.filamentoCents + c.energiaCents + c.depreciacaoCents + c.manutencaoCents);
	});

	it('zera gramas negativas para evitar custo negativo no filamento', () => {
		const e = { ...base, gramas: -100 };
		expect(calcularCusto(e).filamentoCents).toBe(0);
		expect(calcularCusto(e).totalCents).toBeGreaterThanOrEqual(0);
	});

	it('zera duração negativa para evitar energia e depreciação negativas', () => {
		const e = { ...base, duracaoS: -3600 };
		expect(calcularCusto(e).energiaCents).toBe(0);
		expect(calcularCusto(e).depreciacaoCents).toBe(0);
		expect(calcularCusto(e).totalCents).toBeGreaterThanOrEqual(0);
	});

	it('zera gramas NaN para evitar filamento NaN', () => {
		const e = { ...base, gramas: NaN };
		const c = calcularCusto(e);
		expect(Number.isNaN(c.filamentoCents)).toBe(false);
		expect(Number.isNaN(c.totalCents)).toBe(false);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('zera duração NaN para evitar energia e depreciação NaN', () => {
		const e = { ...base, duracaoS: NaN };
		const c = calcularCusto(e);
		expect(Number.isNaN(c.energiaCents)).toBe(false);
		expect(Number.isNaN(c.depreciacaoCents)).toBe(false);
		expect(Number.isNaN(c.totalCents)).toBe(false);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('zera gramas Infinity para evitar filamento Infinity', () => {
		const e = { ...base, gramas: Infinity };
		const c = calcularCusto(e);
		expect(Number.isFinite(c.filamentoCents)).toBe(true);
		expect(Number.isFinite(c.totalCents)).toBe(true);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('zera duração Infinity para evitar energia e depreciação Infinity', () => {
		const e = { ...base, duracaoS: Infinity };
		const c = calcularCusto(e);
		expect(Number.isFinite(c.energiaCents)).toBe(true);
		expect(Number.isFinite(c.depreciacaoCents)).toBe(true);
		expect(Number.isFinite(c.totalCents)).toBe(true);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('saneiza precoPagoCents negativo para evitar filamento negativo', () => {
		const e = { ...base, rolo: { ...base.rolo, precoPagoCents: -12000 } };
		const c = calcularCusto(e);
		expect(c.filamentoCents).toBe(0);
		expect(Number.isFinite(c.totalCents)).toBe(true);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('saneiza precoPagoCents Infinity para evitar filamento Infinity', () => {
		const e = { ...base, rolo: { ...base.rolo, precoPagoCents: Infinity } };
		const c = calcularCusto(e);
		expect(Number.isFinite(c.filamentoCents)).toBe(true);
		expect(Number.isFinite(c.totalCents)).toBe(true);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('saneiza potenciaMediaW NaN para evitar energia NaN', () => {
		const e = { ...base, impressora: { ...base.impressora, potenciaMediaW: NaN } };
		const c = calcularCusto(e);
		expect(Number.isNaN(c.energiaCents)).toBe(false);
		expect(Number.isFinite(c.energiaCents)).toBe(true);
		expect(Number.isFinite(c.totalCents)).toBe(true);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('saneiza potenciaMediaW negativo para evitar energia negativa', () => {
		const e = { ...base, impressora: { ...base.impressora, potenciaMediaW: -100 } };
		const c = calcularCusto(e);
		expect(c.energiaCents).toBe(0);
		expect(Number.isFinite(c.totalCents)).toBe(true);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('saneiza tarifaKwhCents negativo para evitar energia negativa', () => {
		const e = { ...base, tarifaKwhCents: -95 };
		const c = calcularCusto(e);
		expect(c.energiaCents).toBe(0);
		expect(Number.isFinite(c.totalCents)).toBe(true);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('saneiza precoCompraCents negativo para evitar depreciação negativa', () => {
		const e = { ...base, impressora: { ...base.impressora, precoCompraCents: -250000 } };
		const c = calcularCusto(e);
		expect(c.depreciacaoCents).toBe(0);
		expect(Number.isFinite(c.totalCents)).toBe(true);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('saneiza manutencao.totalCents negativo para evitar manutenção negativa', () => {
		const e = { ...base, manutencao: { totalCents: -3000, horasAcumuladas: 100 } };
		const c = calcularCusto(e);
		expect(c.manutencaoCents).toBe(0);
		expect(Number.isFinite(c.totalCents)).toBe(true);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});

	it('saneiza pesoLiquidoInicialG NaN para evitar filamento NaN', () => {
		const e = { ...base, rolo: { ...base.rolo, pesoLiquidoInicialG: NaN } };
		const c = calcularCusto(e);
		expect(Number.isNaN(c.filamentoCents)).toBe(false);
		expect(Number.isFinite(c.totalCents)).toBe(true);
		expect(c.totalCents).toBeGreaterThanOrEqual(0);
	});
});
