import { describe, expect, it } from 'vitest';
import {
	PESO_RELEVANTE_G,
	compararSobra,
	estaEncerrado,
	lerMotivo,
	motivoDoStatus,
	statusDoMotivo
} from './encerramento';

describe('statusDoMotivo · as duas situações cabem nos dois status que já existem', () => {
	it('“acabou” é o rolo vazio — não sobrou filamento', () => {
		expect(statusDoMotivo('acabou')).toBe('vazio');
	});

	it('“sobra” é o rolo descartado — ainda tem material, mas saiu de circulação', () => {
		expect(statusDoMotivo('sobra')).toBe('descartado');
	});

	it('a volta é exata: status → motivo → status', () => {
		expect(motivoDoStatus('vazio')).toBe('acabou');
		expect(motivoDoStatus('descartado')).toBe('sobra');
		expect(statusDoMotivo(motivoDoStatus('vazio')!)).toBe('vazio');
		expect(statusDoMotivo(motivoDoStatus('descartado')!)).toBe('descartado');
	});

	it('rolo em circulação não tem motivo de encerramento', () => {
		expect(motivoDoStatus('fechado')).toBeNull();
		expect(motivoDoStatus('aberto')).toBeNull();
	});

	it('estaEncerrado separa os dois grupos', () => {
		expect(estaEncerrado('vazio')).toBe(true);
		expect(estaEncerrado('descartado')).toBe(true);
		expect(estaEncerrado('aberto')).toBe(false);
		expect(estaEncerrado('fechado')).toBe(false);
	});
});

describe('lerMotivo · o formulário nunca escolhe por ele', () => {
	it('aceita as duas palavras do domínio', () => {
		expect(lerMotivo('acabou')).toBe('acabou');
		expect(lerMotivo('sobra')).toBe('sobra');
	});

	/**
	 * Sem padrão de propósito. Um motivo ausente caindo em "acabou" gravaria
	 * "não sobrou nada" num rolo que tem 800 g — e a diferença entre os dois
	 * motivos é justamente a informação que a feature existe para guardar.
	 */
	it('recusa ausente, vazio, lixo e o nome do status cru', () => {
		expect(lerMotivo(null)).toBeNull();
		expect(lerMotivo('')).toBeNull();
		expect(lerMotivo('   ')).toBeNull();
		expect(lerMotivo('talvez')).toBeNull();
		expect(lerMotivo('vazio')).toBeNull();
		expect(lerMotivo('descartado')).toBeNull();
	});
});

describe('compararSobra · o que o rolo rendeu contra o que o fatiador estimava', () => {
	it('sobra real menor que a estimada: o rolo rendeu menos', () => {
		const r = compararSobra({ estimadaG: 120, realG: 80, pesoInicialG: 1000 });
		expect(r.diferencaG).toBe(-40);
		expect(r.sentido).toBe('a-menos');
		expect(r.fracaoDoRolo).toBeCloseTo(0.04);
	});

	it('sobra real maior que a estimada: o rolo rendeu mais', () => {
		const r = compararSobra({ estimadaG: 120, realG: 160, pesoInicialG: 1000 });
		expect(r.diferencaG).toBe(40);
		expect(r.sentido).toBe('a-mais');
		expect(r.fracaoDoRolo).toBeCloseTo(0.04);
	});

	it('diferença desprezível é “bateu”, e não uma seta para lado nenhum', () => {
		const r = compararSobra({ estimadaG: 120, realG: 120.02, pesoInicialG: 1000 });
		expect(r.diferencaG).toBe(0);
		expect(r.sentido).toBe('bateu');
	});

	/**
	 * O caso do dono: o rolo de amostra de 20 g que vem com a A1. A diferença
	 * existe e é grande em percentual, mas é ruído de balança — o número que
	 * corrige a confiança nas estimativas é o do primeiro rolo de 1 kg.
	 */
	it('marca como irrelevante a comparação de um rolo de amostra', () => {
		expect(compararSobra({ estimadaG: 12, realG: 6, pesoInicialG: 20 }).relevante).toBe(false);
		expect(compararSobra({ estimadaG: 12, realG: 6, pesoInicialG: 250 }).relevante).toBe(true);
	});

	it('o corte é o peso inicial, e ele é o mesmo dos dois lados da borda', () => {
		expect(compararSobra({ estimadaG: 1, realG: 0, pesoInicialG: PESO_RELEVANTE_G }).relevante).toBe(
			true
		);
		expect(
			compararSobra({ estimadaG: 1, realG: 0, pesoInicialG: PESO_RELEVANTE_G - 1 }).relevante
		).toBe(false);
	});

	it('peso inicial não positivo não vira divisão por zero', () => {
		const r = compararSobra({ estimadaG: 10, realG: 0, pesoInicialG: 0 });
		expect(r.fracaoDoRolo).toBe(0);
		expect(Number.isFinite(r.fracaoDoRolo)).toBe(true);
	});

	it('arredonda a diferença em uma casa, como o restante do estoque', () => {
		expect(compararSobra({ estimadaG: 100.44, realG: 90, pesoInicialG: 1000 }).diferencaG).toBe(
			-10.4
		);
	});
});
