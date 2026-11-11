import { describe, expect, it } from 'vitest';
import { ENCHIMENTO_DO_NIVEL, gramasDeSaldo, nivelDoRolo, pesoCurto } from './figura-rolo';

describe('nivelDoRolo', () => {
	it('escolhe o render mais próximo da fração', () => {
		expect(nivelDoRolo(1)).toBe(1);
		expect(nivelDoRolo(0.9)).toBe(2);
		expect(nivelDoRolo(0.64)).toBe(3);
		expect(nivelDoRolo(0.59)).toBe(4);
		expect(nivelDoRolo(0.4)).toBe(5);
		expect(nivelDoRolo(0.25)).toBe(6);
		expect(nivelDoRolo(0.1)).toBe(7);
	});

	it('o percurso da DEMO muda de figura: 640 g e 590 g de 1 kg caem em níveis vizinhos', () => {
		expect(nivelDoRolo(640 / 1000)).not.toBe(nivelDoRolo(590 / 1000));
	});

	it('só o zero de verdade desenha o carretel vazio', () => {
		expect(nivelDoRolo(0)).toBe(8);
		expect(nivelDoRolo(0.0001)).toBe(7);
		expect(nivelDoRolo(0.01)).toBe(7);
	});

	it('fração acima de 1, negativa ou inválida não escapa da escala', () => {
		expect(nivelDoRolo(1.7)).toBe(1);
		expect(nivelDoRolo(-0.2)).toBe(8);
		expect(nivelDoRolo(Number.NaN)).toBe(8);
		expect(nivelDoRolo(null)).toBe(8);
		expect(nivelDoRolo(undefined)).toBe(8);
	});

	it('os oito níveis estão em ordem decrescente, do cheio ao vazio', () => {
		expect(ENCHIMENTO_DO_NIVEL).toHaveLength(8);
		for (let n = 1; n < ENCHIMENTO_DO_NIVEL.length; n++) {
			expect(ENCHIMENTO_DO_NIVEL[n]).toBeLessThan(ENCHIMENTO_DO_NIVEL[n - 1]);
		}
	});
});

describe('pesoCurto e gramasDeSaldo', () => {
	it('passa para quilos a partir de 1.000 g', () => {
		expect(pesoCurto(1000)).toBe('1 kg');
		expect(pesoCurto(1640)).toBe('1,64 kg');
		expect(pesoCurto(1500)).toBe('1,5 kg');
		expect(pesoCurto(250)).toBe('250 g');
		expect(pesoCurto(999.5)).toBe('999,5 g');
	});

	it('saldo inteiro sem casas, quebrado com uma', () => {
		expect(gramasDeSaldo(640)).toBe('640');
		expect(gramasDeSaldo(639.9)).toBe('639,9');
		expect(gramasDeSaldo(0)).toBe('0');
		expect(gramasDeSaldo(1250)).toBe('1.250');
	});
});
