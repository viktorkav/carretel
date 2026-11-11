import { describe, expect, it } from 'vitest';
import { duracaoParaSegundos } from '../routes/impressoes/duracao';
import {
	duracaoCurta,
	frase,
	inicial,
	massa,
	paraCampoDataHora,
	paraCampoDecimal,
	paraCampoDuracao
} from './formato';

/**
 * Os dois formatadores existem para PREENCHER um formulário de edição, então o
 * que importa deles não é a aparência: é a ida e volta. Se o valor que a tela
 * escreve não é o mesmo que o parser lê, salvar sem tocar no campo já altera a
 * impressão.
 */
describe('paraCampoDataHora', () => {
	it('escreve a hora local, não o UTC', () => {
		const d = new Date(2026, 7, 9, 21, 5);
		expect(paraCampoDataHora(d)).toBe('2026-08-09T21:05');
	});

	it('sobrevive à ida e volta pelo parser do campo', () => {
		const d = new Date(2026, 2, 1, 0, 30);
		expect(new Date(paraCampoDataHora(d)).getTime()).toBe(d.getTime());
	});

	it('completa os dígitos de mês, dia, hora e minuto', () => {
		expect(paraCampoDataHora(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02T03:04');
	});
});

describe('paraCampoDuracao', () => {
	it('sobrevive à ida e volta pelo parser de duração', () => {
		for (const segundos of [0, 1800, 3600, 12_960, 86_400]) {
			expect(duracaoParaSegundos(paraCampoDuracao(segundos))).toBe(segundos);
		}
	});

	it('não usa separador de milhar — ele quebraria o parser', () => {
		const texto = paraCampoDuracao(4_500_000); // 1250 h
		expect(texto).toBe('1250,00h');
		expect(duracaoParaSegundos(texto)).toBe(4_500_000);
	});
});

describe('inicial', () => {
	it('só muda a primeira letra, inclusive acentuada', () => {
		expect(inicial('estúdio')).toBe('Estúdio');
		expect(inicial('água e sabão')).toBe('Água e sabão');
		expect(inicial('PLA')).toBe('PLA');
	});
	it('texto vazio continua vazio', () => {
		expect(inicial('')).toBe('');
	});
});

describe('massa', () => {
	it('inteiro sai sem casas, e fração só com as casas que tem', () => {
		expect(massa(50)).toBe('50 g');
		expect(massa(82.5)).toBe('82,5 g');
		expect(massa(0.04)).toBe('0,04 g');
		expect(massa(1640)).toBe('1.640 g');
	});
	it('valor que não é número não vira "NaN g"', () => {
		expect(massa(Number.NaN)).toBe('—');
	});
});

describe('duracaoCurta', () => {
	it('minutos, horas cheias e horas com minutos', () => {
		expect(duracaoCurta(1800)).toBe('30 min');
		expect(duracaoCurta(3600)).toBe('1 h');
		expect(duracaoCurta(5400)).toBe('1 h 30 min');
		expect(duracaoCurta(3900)).toBe('1 h 05 min');
	});
	it('duração inválida não vira número', () => {
		expect(duracaoCurta(-1)).toBe('—');
	});
});

describe('frase', () => {
	it('começa com maiúscula e termina com ponto', () => {
		expect(frase('preço pago inválido; use algo como 129,90')).toBe(
			'Preço pago inválido; use algo como 129,90.'
		);
		expect(frase('rolo não encontrado')).toBe('Rolo não encontrado.');
	});

	it('não dobra a pontuação que já existe', () => {
		expect(frase('Filamento ativo. Sua próxima impressão considerará esta seleção.')).toBe(
			'Filamento ativo. Sua próxima impressão considerará esta seleção.'
		);
		expect(frase('excluir de verdade?')).toBe('Excluir de verdade?');
		expect(frase('marque "ajustar o peso inicial".')).toBe('Marque "ajustar o peso inicial".');
		expect(frase('confira (a balança e o carretel.)')).toBe('Confira (a balança e o carretel.)');
	});

	it('fecha a frase que termina em aspas ou parêntese sem ponto', () => {
		expect(frase('marque "ajustar o peso inicial"')).toBe('Marque "ajustar o peso inicial".');
		expect(frase('a pesagem passa do cadastro (1000 g)')).toBe('A pesagem passa do cadastro (1000 g).');
	});

	it('não inventa frase de texto vazio', () => {
		expect(frase('')).toBe('');
		expect(frase('   ')).toBe('');
	});
});

describe('paraCampoDecimal', () => {
	it('escreve o decimal com vírgula, como o campo é digitado', () => {
		expect(paraCampoDecimal(0.2)).toBe('0,2');
		expect(paraCampoDecimal(82.5)).toBe('82,5');
		expect(paraCampoDecimal(1.24)).toBe('1,24');
	});

	it('não inventa casas no inteiro', () => {
		expect(paraCampoDecimal(1000)).toBe('1000');
		expect(paraCampoDecimal(0)).toBe('0');
	});

	it('deixa o campo vazio quando não há número', () => {
		expect(paraCampoDecimal(null)).toBe('');
		expect(paraCampoDecimal(undefined)).toBe('');
		expect(paraCampoDecimal(Number.NaN)).toBe('');
	});
});
