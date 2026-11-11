import { describe, expect, it } from 'vitest';
import { duracaoParaSegundos } from './duracao';

describe('duracaoParaSegundos', () => {
	it('converte horas decimais com "h"', () => {
		expect(duracaoParaSegundos('3.6h')).toBe(12960);
	});

	it('converte outro valor de horas decimais', () => {
		expect(duracaoParaSegundos('4.5h')).toBe(16200);
	});

	it('converte horas decimais fracionárias pequenas', () => {
		expect(duracaoParaSegundos('0.5h')).toBe(1800);
	});

	it('converte formato hh:mm', () => {
		expect(duracaoParaSegundos('3:36')).toBe(12960);
	});

	it('converte hh:mm com horas zero', () => {
		expect(duracaoParaSegundos('0:45')).toBe(2700);
	});

	it('trata número puro como minutos', () => {
		expect(duracaoParaSegundos('215')).toBe(12900);
	});

	it('texto vazio vira zero', () => {
		expect(duracaoParaSegundos('')).toBe(0);
	});

	it('texto não numérico vira zero', () => {
		expect(duracaoParaSegundos('abc')).toBe(0);
	});

	it('horas negativas com "h" viram zero, nunca negativo', () => {
		expect(duracaoParaSegundos('-2h')).toBe(0);
	});

	it('aceita vírgula como separador decimal, igual ao ponto', () => {
		expect(duracaoParaSegundos('3,6h')).toBe(12960);
	});

	it('tolera espaços ao redor do valor', () => {
		expect(duracaoParaSegundos('  3.6h  ')).toBe(12960);
	});

	it('tolera espaço entre o número e o "h"', () => {
		expect(duracaoParaSegundos('3.6 h')).toBe(12960);
	});

	it('tolera espaços ao redor dos dois lados de hh:mm', () => {
		expect(duracaoParaSegundos(' 3 : 36 ')).toBe(12960);
	});

	it('tolera espaços ao redor de um valor em minutos', () => {
		expect(duracaoParaSegundos('  215  ')).toBe(12900);
	});

	it('nunca produz NaN', () => {
		expect(Number.isNaN(duracaoParaSegundos('***'))).toBe(false);
	});

	it('nunca produz negativo em hh:mm com componente negativo', () => {
		expect(duracaoParaSegundos('-3:36')).toBeGreaterThanOrEqual(0);
	});

	it('rejeita hh:mm com minutos fora de 0-59', () => {
		expect(duracaoParaSegundos('1:75')).toBe(0);
	});

	it('rejeita hh:mm com mais de um separador ":"', () => {
		expect(duracaoParaSegundos('1:2:3')).toBe(0);
	});

	it('rejeita número puro negativo, nunca produz negativo', () => {
		expect(duracaoParaSegundos('-100')).toBe(0);
	});
});
