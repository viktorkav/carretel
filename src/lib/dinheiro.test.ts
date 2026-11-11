import { describe, expect, it } from 'vitest';
import {
	centavosParaTexto,
	textoParaCentavos,
	textoParaCentavosEstrito,
	textoParaCentavosPositivo
} from './dinheiro';

describe('textoParaCentavos', () => {
	it('aceita vírgula decimal', () => {
		expect(textoParaCentavos('129,90')).toBe(12990);
	});

	it('aceita ponto decimal', () => {
		expect(textoParaCentavos('129.90')).toBe(12990);
	});

	it('aceita separador de milhar', () => {
		expect(textoParaCentavos('1.299,90')).toBe(129990);
	});

	it('aceita inteiro sem decimais', () => {
		expect(textoParaCentavos('129')).toBe(12900);
	});

	it('devolve zero para texto vazio', () => {
		expect(textoParaCentavos('')).toBe(0);
	});

	// Regra aprovada pelo dono do projeto (achado 1 da revisão): o ponto é
	// interpretado pelo tamanho do grupo de dígitos que vem depois dele.
	// 3 dígitos → milhar; 1 ou 2 dígitos → decimal. Vírgula continua sempre
	// decimal, e nesse caso todo ponto é milhar (comportamento já existente).
	it('ponto seguido de 3 dígitos é separador de milhar, mesmo sem centavos', () => {
		expect(textoParaCentavos('1.899')).toBe(189900);
	});

	it('ponto seguido de 1 dígito é separador decimal', () => {
		expect(textoParaCentavos('129.9')).toBe(12990);
	});

	it('vários pontos seguidos de 3 dígitos são todos milhar', () => {
		expect(textoParaCentavos('1.234.567')).toBe(123456700);
	});

	it('milhar com ponto e decimal com vírgula juntos', () => {
		expect(textoParaCentavos('1.234.567,89')).toBe(123456789);
	});

	it('vírgula decimal sem parte inteira', () => {
		expect(textoParaCentavos('0,5')).toBe(50);
	});

	it('vírgula decimal sem o zero à esquerda', () => {
		expect(textoParaCentavos(',50')).toBe(50);
	});

	// Minor da revisão: negativo não faz sentido para nenhum valor monetário
	// do domínio (preço pago, preço de compra) — normaliza pra zero em vez
	// de aceitar em silêncio.
	it('recusa valor negativo, devolvendo zero', () => {
		expect(textoParaCentavos('-129,90')).toBe(0);
	});
});

// Achado da revisão da Task 8: um valor que ATUALIZA uma config global (a
// tarifa de energia) não pode saturar em zero por typo — diferente de um
// preço de cadastro, que `textoParaCentavos` cobre bem, um zero acidental
// aqui contamina todo custo de energia calculado depois, silenciosamente.
describe('textoParaCentavosPositivo', () => {
	it('recusa texto vazio', () => {
		expect(textoParaCentavosPositivo('')).toBeNull();
	});

	it('recusa texto não numérico', () => {
		expect(textoParaCentavosPositivo('abc')).toBeNull();
	});

	it('recusa negativo', () => {
		expect(textoParaCentavosPositivo('-50')).toBeNull();
	});

	it('recusa zero — tarifa zero não existe no mundo real', () => {
		expect(textoParaCentavosPositivo('0')).toBeNull();
	});

	it('aceita inteiro positivo', () => {
		expect(textoParaCentavosPositivo('95')).toBe(9500);
	});

	it('aceita vírgula decimal com separador de milhar', () => {
		expect(textoParaCentavosPositivo('1.234,56')).toBe(123456);
	});
});

/**
 * "1e999" é a entrada que passa por qualquer guarda escrita contra NaN e contra
 * sinal: `Number('1e999')` é Infinity, que não é NaN e não é ≤ 0. Gravado, ele
 * vira "R$ Infinity,undefined" na tela, desarma toda comparação de faixa
 * (`Infinity < pico` é falso) e, num recálculo, `sanitizar` o transforma em
 * zero — custo zerado em lote a partir de um campo que ninguém conferiu.
 */
describe('valor fora de faixa (Infinity)', () => {
	it('não deixa 1e999 virar centavo em nenhuma das três variantes', () => {
		expect(textoParaCentavos('1e999')).toBe(0);
		expect(textoParaCentavosPositivo('1e999')).toBe(null);
		expect(textoParaCentavosEstrito('1e999')).toBe(null);
	});

	it('recusa também a notação negativa e o infinito escrito por extenso', () => {
		expect(textoParaCentavosPositivo('-1e999')).toBe(null);
		expect(textoParaCentavosEstrito('-1e999')).toBe(null);
		expect(textoParaCentavosPositivo('Infinity')).toBe(null);
	});

	it('continua aceitando notação científica dentro da faixa', () => {
		expect(textoParaCentavosEstrito('1e3')).toBe(100000);
	});
});

describe('textoParaCentavosEstrito', () => {
	// A diferença para `textoParaCentavosPositivo` é uma só, e é a que permite
	// editar o cadastro de uma impressora cujo preço o usuário nunca soube:
	// zero passa, porque é assim que "não informado" volta preenchido na tela.
	it('aceita zero, que a variante positiva recusa', () => {
		expect(textoParaCentavosEstrito('0,00')).toBe(0);
		expect(textoParaCentavosEstrito('0')).toBe(0);
		expect(textoParaCentavosPositivo('0,00')).toBe(null);
	});

	it('recusa vazio, lixo e negativo', () => {
		expect(textoParaCentavosEstrito('')).toBe(null);
		expect(textoParaCentavosEstrito('129,9O')).toBe(null);
		expect(textoParaCentavosEstrito('-10')).toBe(null);
	});

	it('lê valor normal igual às outras variantes', () => {
		expect(textoParaCentavosEstrito('129,90')).toBe(12990);
	});
});

describe('centavosParaTexto', () => {
	it('formata em reais com duas casas', () => {
		expect(centavosParaTexto(12990)).toBe('129,90');
	});

	it('formata zero', () => {
		expect(centavosParaTexto(0)).toBe('0,00');
	});
});
