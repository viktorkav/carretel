import { describe, expect, it } from 'vitest';
import { contador, lerCodigo, pedacoDoCodigo, prefixoDoCodigo, proximoCodigo } from './codigo';

describe('pedacoDoCodigo', () => {
	it('pega só a primeira palavra — a família, não o nome comercial', () => {
		expect(pedacoDoCodigo('PLA Basic', 6, 'ROLO')).toBe('PLA');
		expect(pedacoDoCodigo('PETG HF', 6, 'ROLO')).toBe('PETG');
	});

	it('dobra acento, porque caneta em plástico não escreve til', () => {
		expect(pedacoDoCodigo('Abóbora', 8, 'COR')).toBe('ABOBORA');
		expect(pedacoDoCodigo('Limão', 8, 'COR')).toBe('LIMAO');
	});

	it('trata hífen como separador de palavra', () => {
		expect(pedacoDoCodigo('Verde-limão', 8, 'COR')).toBe('VERDE');
		expect(pedacoDoCodigo('PLA-CF', 6, 'ROLO')).toBe('PLA');
	});

	it('trunca no tamanho pedido', () => {
		expect(pedacoDoCodigo('POLICARBONATO', 6, 'ROLO')).toBe('POLICA');
		expect(pedacoDoCodigo('TURQUESADO', 8, 'COR')).toBe('TURQUESA');
	});

	it('mantém dígitos, que fazem parte do nome de material', () => {
		expect(pedacoDoCodigo('TPU95A', 6, 'ROLO')).toBe('TPU95A');
	});

	it('cai na reserva quando não sobra letra nem número', () => {
		expect(pedacoDoCodigo('+++', 6, 'ROLO')).toBe('ROLO');
		expect(pedacoDoCodigo('   ', 8, 'COR')).toBe('COR');
	});
});

describe('prefixoDoCodigo', () => {
	it('junta material e cor com hífen', () => {
		expect(prefixoDoCodigo({ material: 'PLA Basic', cor: 'Preto' })).toBe('PLA-PRETO');
	});

	it('junta PLA Basic e PLA Matte no mesmo prefixo — o contador é que separa', () => {
		const basic = prefixoDoCodigo({ material: 'PLA Basic', cor: 'Preto' });
		const matte = prefixoDoCodigo({ material: 'PLA Matte', cor: 'Preto' });
		expect(basic).toBe(matte);
	});
});

describe('contador', () => {
	it('usa dois dígitos até 99, para que 3 e 03 não virem coisas diferentes na prateleira', () => {
		expect(contador(1)).toBe('01');
		expect(contador(9)).toBe('09');
		expect(contador(10)).toBe('10');
		expect(contador(99)).toBe('99');
	});

	it('passa dos dois dígitos em vez de estourar', () => {
		expect(contador(100)).toBe('100');
		expect(contador(1234)).toBe('1234');
	});
});

describe('proximoCodigo', () => {
	it('começa em 01', () => {
		expect(proximoCodigo({ material: 'PLA Basic', cor: 'Preto' }, [])).toBe('PLA-PRETO-01');
	});

	it('a segunda compra do MESMO filamento é 02, não a mesma linha', () => {
		expect(proximoCodigo({ material: 'PLA Basic', cor: 'Preto' }, ['PLA-PRETO-01'])).toBe(
			'PLA-PRETO-02'
		);
	});

	it('cada prefixo tem a sua contagem', () => {
		const usados = ['PLA-PRETO-01', 'PLA-PRETO-02'];
		expect(proximoCodigo({ material: 'PETG HF', cor: 'Preto' }, usados)).toBe('PETG-PRETO-01');
	});

	/**
	 * Pegar `máximo + 1` seria mais simples e colidiria: apagado o rolo 2 de
	 * três, o próximo cadastro sairia como 03 — e o 03 está escrito num carretel
	 * que está na prateleira.
	 */
	it('preenche o buraco deixado por um rolo apagado em vez de reusar um número em uso', () => {
		const usados = ['PLA-PRETO-01', 'PLA-PRETO-03'];
		expect(proximoCodigo({ material: 'PLA Basic', cor: 'Preto' }, usados)).toBe('PLA-PRETO-02');
	});

	it('não se confunde com código digitado em caixa baixa', () => {
		expect(proximoCodigo({ material: 'PLA', cor: 'Preto' }, ['pla-preto-01'])).toBe('PLA-PRETO-02');
	});
});

describe('lerCodigo', () => {
	it('aceita o formato gerado', () => {
		expect(lerCodigo('PLA-PRETO-03')).toEqual({ ok: true, valor: 'PLA-PRETO-03' });
	});

	it('sobe a caixa e troca espaço por hífen, em vez de implicar', () => {
		expect(lerCodigo('  pla preto 03 ')).toEqual({ ok: true, valor: 'PLA-PRETO-03' });
	});

	it('aceita um código inventado pelo dono', () => {
		expect(lerCodigo('GAVETA2')).toEqual({ ok: true, valor: 'GAVETA2' });
	});

	it('recusa em branco — o código é a identidade do rolo na prateleira', () => {
		expect(lerCodigo('').ok).toBe(false);
		expect(lerCodigo('   ').ok).toBe(false);
		expect(lerCodigo(null).ok).toBe(false);
	});

	it('recusa acento, que não sobrevive à caneta nem à busca', () => {
		expect(lerCodigo('PLA-VERMELHÃO-01').ok).toBe(false);
	});

	it('recusa símbolo', () => {
		expect(lerCodigo('PLA/PRETO').ok).toBe(false);
		expect(lerCodigo('PLA_PRETO').ok).toBe(false);
	});

	it('recusa começar por hífen', () => {
		expect(lerCodigo('-PLA').ok).toBe(false);
	});

	it('recusa código longo demais para caber no carretel', () => {
		expect(lerCodigo('A'.repeat(24)).ok).toBe(true);
		expect(lerCodigo('A'.repeat(25)).ok).toBe(false);
	});
});
