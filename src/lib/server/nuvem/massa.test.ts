import { describe, expect, it } from 'vitest';
import {
	AREA_FILAMENTO_CM2,
	comprimentoParaMassaCm,
	densidadeImplicita,
	massaPelaDensidade,
	notaDeMassa
} from './massa';

/** O par (peso, comprimento) que a nuvem mandaria para um dado perfil. */
function tarefa(gramas: number, densidadePerfil: number) {
	return { gramasNuvem: gramas, comprimentoCm: comprimentoParaMassaCm(gramas, densidadePerfil) };
}

describe('a geometria do filamento de 1,75 mm', () => {
	it('a seção transversal é π × 0,0875²', () => {
		expect(AREA_FILAMENTO_CM2).toBeCloseTo(0.0240528, 7);
	});

	it('deduz a densidade que o fatiador usou a partir do par que a nuvem manda', () => {
		const { gramasNuvem, comprimentoCm } = tarefa(82.5, 1.24);
		expect(densidadeImplicita(gramasNuvem, comprimentoCm)).toBeCloseTo(1.24, 6);
	});

	it('recusa comprimento zero em vez de dividir por zero', () => {
		expect(densidadeImplicita(82.5, 0)).toBeNull();
	});

	it('recusa peso zero', () => {
		expect(densidadeImplicita(0, 2765)).toBeNull();
	});
});

describe('massaPelaDensidade — quando corrige', () => {
	it('reescreve o peso quando o perfil usou densidade diferente da do rolo', () => {
		// Fatiado como PLA (1,24) e impresso num rolo de 1,31: é o caso medido na
		// base real, e o erro é sempre para "sobra mais".
		const r = massaPelaDensidade({ ...tarefa(82.5, 1.24), densidadeRolo: 1.31 });

		expect(r.aplicado).toBe(true);
		if (!r.aplicado) return;
		expect(r.gramas).toBeCloseTo(87.16, 2);
		expect(r.densidadePerfil).toBeCloseTo(1.24, 3);
		expect(r.deltaG).toBeGreaterThan(0);
	});

	it('a correção é exatamente a razão entre as duas densidades', () => {
		const r = massaPelaDensidade({ ...tarefa(100, 1.24), densidadeRolo: 1.31 });
		if (!r.aplicado) throw new Error('deveria ter corrigido');
		expect(r.gramas).toBeCloseTo(100 * (1.31 / 1.24), 2);
	});

	it('corrige para BAIXO quando o rolo é menos denso que o perfil', () => {
		const r = massaPelaDensidade({ ...tarefa(100, 1.27), densidadeRolo: 1.04 });
		if (!r.aplicado) throw new Error('deveria ter corrigido');
		expect(r.gramas).toBeLessThan(100);
		expect(r.deltaG).toBeLessThan(0);
	});

	it('escreve a nota com os dois números, para a impressão explicar o próprio peso', () => {
		const r = massaPelaDensidade({ ...tarefa(82.5, 1.24), densidadeRolo: 1.31 });
		const nota = notaDeMassa(r, 82.5);
		expect(nota).toContain('82,50 g');
		expect(nota).toContain('1,240');
		expect(nota).toContain('1,310');
	});
});

describe('massaPelaDensidade — quando NÃO corrige', () => {
	/**
	 * "Não veio comprimento" e "o par não fecha" são coisas diferentes, e o
	 * motivo tem que dizer qual das duas foi: a primeira é a nuvem não mandando
	 * um campo, a segunda é suspeita de dado corrompido ou de unidade errada.
	 */
	it('mantém o peso da nuvem quando não veio comprimento, e diz que foi isso', () => {
		const r = massaPelaDensidade({ gramasNuvem: 82.5, comprimentoCm: null, densidadeRolo: 1.31 });
		expect(r.aplicado).toBe(false);
		expect(r.gramas).toBe(82.5);
		if (r.aplicado) return;
		expect(r.motivo).toMatch(/não mandou o comprimento/);
	});

	it('comprimento zero é ausência de comprimento, não medida de zero', () => {
		const r = massaPelaDensidade({ gramasNuvem: 82.5, comprimentoCm: 0, densidadeRolo: 1.31 });
		expect(r.aplicado).toBe(false);
		expect(r.gramas).toBe(82.5);
		if (r.aplicado) return;
		expect(r.motivo).toMatch(/não mandou o comprimento/);
	});

	it('comprimento negativo também', () => {
		const r = massaPelaDensidade({ gramasNuvem: 82.5, comprimentoCm: -10, densidadeRolo: 1.31 });
		expect(r.aplicado).toBe(false);
		if (r.aplicado) return;
		expect(r.motivo).toMatch(/não mandou o comprimento/);
	});

	/**
	 * A guarda que impede o pior desfecho possível: `length` vindo em outra
	 * unidade multiplicaria (ou dividiria) o estoque por dez em silêncio. Com o
	 * comprimento em MILÍMETROS, o par implica densidade 0,124 — que não é
	 * filamento nenhum, e a correção não sai.
	 */
	it('recusa a conta quando o comprimento vem em milímetros', () => {
		const emCm = comprimentoParaMassaCm(82.5, 1.24);
		const r = massaPelaDensidade({
			gramasNuvem: 82.5,
			comprimentoCm: emCm * 10,
			densidadeRolo: 1.31
		});
		expect(r.aplicado).toBe(false);
		expect(r.gramas).toBe(82.5);
		if (r.aplicado) return;
		expect(r.motivo).toContain('não fecham');
	});

	it('recusa a conta quando o comprimento vem em metros', () => {
		const emCm = comprimentoParaMassaCm(82.5, 1.24);
		const r = massaPelaDensidade({
			gramasNuvem: 82.5,
			comprimentoCm: emCm / 100,
			densidadeRolo: 1.31
		});
		expect(r.aplicado).toBe(false);
		expect(r.gramas).toBe(82.5);
	});

	it('não mexe quando o perfil já usou a densidade do rolo', () => {
		const r = massaPelaDensidade({ ...tarefa(82.5, 1.31), densidadeRolo: 1.31 });
		expect(r.aplicado).toBe(false);
		expect(r.gramas).toBe(82.5);
	});

	it('não mexe quando o rolo está sem densidade utilizável', () => {
		const r = massaPelaDensidade({ ...tarefa(82.5, 1.24), densidadeRolo: 0 });
		expect(r.aplicado).toBe(false);
		expect(r.gramas).toBe(82.5);
	});

	it('não devolve nota quando não corrigiu', () => {
		const r = massaPelaDensidade({ gramasNuvem: 82.5, comprimentoCm: null, densidadeRolo: 1.31 });
		expect(notaDeMassa(r, 82.5)).toBeNull();
	});
});
