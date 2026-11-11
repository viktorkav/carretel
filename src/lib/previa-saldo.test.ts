/**
 * A prévia do saldo contra o domínio, em vários fusos.
 *
 * O contrato: quando `preverSaldo` afirma (`baixa` ou `nao-baixa`), a
 * afirmação é a mesma coisa que `calcularRestante` faz com o instante que o
 * SERVIDOR dá ao texto do campo. Quando não pode afirmar, diz `indeterminado`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { calcularRestante, parcelasDoSaldo, type EntradaEstoque } from '$lib/server/estoque';
import { paraCampoDataHora } from '$lib/formato';
import { descreverBase, instanteNoFuso, preverSaldo, saldoArredondado } from './previa-saldo';

const MIN = 60_000;
const HORA = 3_600_000;
const FUSO_ORIGINAL = process.env.TZ;
const noFuso = (zona: string) => { process.env.TZ = zona; };
afterAll(() => {
	if (FUSO_ORIGINAL === undefined) delete process.env.TZ;
	else process.env.TZ = FUSO_ORIGINAL;
});

/** O que o servidor faria: lê o texto no fuso dele e aplica a regra do domínio. */
function dominio(entrada: EntradaEstoque, gramas: number, texto: string) {
	const inicioEm = new Date(texto).getTime();
	return calcularRestante({ ...entrada, impressoes: [...entrada.impressoes, { gramas, inicioEm }] }).restanteG;
}

function rolo(pesagemEm: number): EntradaEstoque {
	return {
		pesoInicialG: 1000,
		afericoes: [{ pesoLiquidoG: 700, dataEm: pesagemEm }],
		impressoes: [
			{ gramas: 40, inicioEm: pesagemEm + 24 * HORA },
			{ gramas: 20, inicioEm: pesagemEm + 48 * HORA }
		]
	};
}

describe('o fuso do processo realmente troca neste ambiente de teste', () => {
	it('o mesmo texto vira instantes diferentes em fusos diferentes', () => {
		noFuso('UTC');
		const emUtc = new Date('2026-07-01T10:00').getTime();
		noFuso('Asia/Tokyo');
		const emToquio = new Date('2026-07-01T10:00').getTime();
		expect(emUtc - emToquio).toBe(9 * HORA);
	});
});

describe('preverSaldo afirma o mesmo que o domínio', () => {
	// Uma pesagem em minuto cheio, longe de qualquer virada de horário.
	const PESAGEM = Date.UTC(2026, 6, 15, 13, 0);

	for (const zona of ['UTC', 'America/Sao_Paulo', 'America/Fortaleza', 'Asia/Kolkata', 'Europe/Lisbon', 'Australia/Lord_Howe']) {
		it(`servidor em ${zona}: antes, igual e depois da pesagem`, () => {
			noFuso(zona);
			const entrada = rolo(PESAGEM);
			const base = descreverBase(parcelasDoSaldo(entrada), PESAGEM + 7 * 24 * HORA);
			expect(base.fusoEstavel).toBe(true);
			for (const desvio of [-400 * 24 * HORA, -24 * HORA, -4 * HORA, -HORA, -MIN, 0, MIN, HORA, 4 * HORA, 24 * HORA, 200 * 24 * HORA]) {
				const texto = paraCampoDataHora(PESAGEM + desvio);
				const previa = preverSaldo(base, 50, texto);
				const real = dominio(entrada, 50, texto);
				expect(previa.efeito, `${zona} ${texto}`).not.toBe('indeterminado');
				expect(previa.efeito === 'baixa' ? previa.depoisG : 640, `${zona} ${texto}`).toBe(real);
				// E o valor é o esperado, não só coerente: só baixa quem começa DEPOIS.
				expect(real, `${zona} ${texto}`).toBe(desvio > 0 ? 590 : 640);
			}
		});
	}

	it('início igual à pesagem não baixa; a prévia diz 640 g mantidos', () => {
		noFuso('America/Sao_Paulo');
		const entrada = rolo(PESAGEM);
		const base = descreverBase(parcelasDoSaldo(entrada), PESAGEM + HORA);
		expect(preverSaldo(base, 50, paraCampoDataHora(PESAGEM))).toEqual({ efeito: 'nao-baixa' });
	});

	it('pesagem com segundos: o mesmo minuto digitado cai antes dela e não baixa', () => {
		noFuso('America/Sao_Paulo');
		const entrada = rolo(PESAGEM + 30_000);
		const base = descreverBase(parcelasDoSaldo(entrada), PESAGEM + HORA);
		const texto = paraCampoDataHora(PESAGEM);
		expect(preverSaldo(base, 50, texto)).toEqual({ efeito: 'nao-baixa' });
		expect(dominio(entrada, 50, texto)).toBe(640);
	});

	it('navegador em outro fuso que o servidor: a resposta é a do servidor', () => {
		noFuso('America/Sao_Paulo');
		const entrada = rolo(PESAGEM);
		const base = descreverBase(parcelasDoSaldo(entrada), PESAGEM + 7 * 24 * HORA);
		// 30 min depois da pesagem, no relógio do SERVIDOR.
		const texto = paraCampoDataHora(PESAGEM + 30 * MIN);
		const real = dominio(entrada, 50, texto);
		expect(real).toBe(590);
		// A pessoa abre a tela em Tóquio: lido no relógio dela, esse mesmo texto
		// seria 12 h ANTES da pesagem. A prévia não usa o relógio dela.
		noFuso('Asia/Tokyo');
		expect(new Date(texto).getTime()).toBeLessThan(PESAGEM);
		expect(preverSaldo(base, 50, texto)).toEqual({ efeito: 'baixa', depoisG: 590 });
	});

	it('em branco: baixa se a pesagem já passou; não afirma se a pesagem está no futuro', () => {
		noFuso('UTC');
		const entrada = rolo(PESAGEM);
		const parcelas = parcelasDoSaldo(entrada);
		expect(preverSaldo(descreverBase(parcelas, PESAGEM + 1), 50, '')).toEqual({ efeito: 'baixa', depoisG: 590 });
		expect(preverSaldo(descreverBase(parcelas, PESAGEM - HORA), 50, '  ')).toEqual({ efeito: 'indeterminado', motivo: 'pesagem-futura' });
	});

	it('rolo nunca pesado: toda data baixa', () => {
		noFuso('UTC');
		const entrada: EntradaEstoque = { pesoInicialG: 1000, afericoes: [], impressoes: [{ gramas: 360, inicioEm: PESAGEM }] };
		const base = descreverBase(parcelasDoSaldo(entrada), PESAGEM + HORA);
		const texto = paraCampoDataHora(PESAGEM - 900 * 24 * HORA);
		expect(preverSaldo(base, 50, texto)).toEqual({ efeito: 'baixa', depoisG: 590 });
		expect(dominio(entrada, 50, texto)).toBe(590);
	});

	it('texto que não é data de campo: não afirma nada', () => {
		noFuso('UTC');
		const base = descreverBase(parcelasDoSaldo(rolo(PESAGEM)), PESAGEM + HORA);
		for (const texto of ['amanhã', '2026-02-31T10:00', '2026-07-15', '2026-07-15T25:00']) {
			expect(preverSaldo(base, 50, texto), texto).toEqual({ efeito: 'indeterminado', motivo: 'data-ilegivel' });
		}
	});
});

describe('virada de horário de verão no servidor', () => {
	// Nova York, 1º/11/2026: às 06:00 UTC o relógio volta de 02:00 para 01:00.
	const VIRADA = Date.UTC(2026, 10, 1, 6, 0);

	it('pesagem perto da virada: dentro da janela não afirma; fora dela afirma e acerta', () => {
		noFuso('America/New_York');
		const pesagem = VIRADA - 20 * MIN;
		const entrada = rolo(pesagem);
		const base = descreverBase(parcelasDoSaldo(entrada), pesagem + 30 * 24 * HORA);
		expect(base.fusoEstavel).toBe(false);
		for (const desvio of [-2 * HORA, -MIN, 0, 30 * MIN, 2 * HORA]) {
			const previa = preverSaldo(base, 50, paraCampoDataHora(pesagem + desvio));
			expect(previa).toEqual({ efeito: 'indeterminado', motivo: 'virada-de-horario' });
		}
		for (const desvio of [-30 * 24 * HORA, -6 * HORA, 6 * HORA, 20 * 24 * HORA]) {
			const texto = paraCampoDataHora(pesagem + desvio);
			const previa = preverSaldo(base, 50, texto);
			expect(previa.efeito, texto).not.toBe('indeterminado');
			expect(previa.efeito === 'baixa' ? previa.depoisG : 640, texto).toBe(dominio(entrada, 50, texto));
		}
	});

	it('nunca afirma o contrário do domínio, minuto a minuto, atravessando a virada', () => {
		noFuso('America/New_York');
		for (const pesagem of [VIRADA - 90 * MIN, VIRADA - MIN, VIRADA, VIRADA + 45 * MIN, VIRADA + 5 * HORA]) {
			const entrada = rolo(pesagem);
			const base = descreverBase(parcelasDoSaldo(entrada), pesagem + 30 * 24 * HORA);
			for (let desvio = -8 * HORA; desvio <= 8 * HORA; desvio += 7 * MIN) {
				const texto = paraCampoDataHora(pesagem + desvio);
				const previa = preverSaldo(base, 50, texto);
				if (previa.efeito === 'indeterminado') continue;
				expect(previa.efeito === 'baixa' ? previa.depoisG : 640, `${pesagem} ${texto}`).toBe(dominio(entrada, 50, texto));
			}
		}
	});
});

describe('arredondamento e limite em zero iguais aos do domínio', () => {
	it('saldoArredondado devolve o mesmo que calcularRestante para as mesmas parcelas', () => {
		const casos: [number, number[], number][] = [
			[700, [40, 20], 50], [700, [0.04], 0.04], [700, [], 0.01], [700, [], 0.05], [700, [], 0.1],
			[30, [], 50], [0, [], 50], [1000, [333.33, 333.33], 333.34], [12.3, [0.15, 0.15], 0.25]
		];
		for (const [pesoG, anteriores, gramas] of casos) {
			const entrada: EntradaEstoque = { pesoInicialG: 1000, afericoes: [{ pesoLiquidoG: pesoG, dataEm: 1000 }], impressoes: anteriores.map((g, n) => ({ gramas: g, inicioEm: 2000 + n })) };
			const p = parcelasDoSaldo(entrada);
			expect(saldoArredondado(p.baseG, p.consumidoG)).toBe(calcularRestante(entrada).restanteG);
			const real = calcularRestante({ ...entrada, impressoes: [...entrada.impressoes, { gramas, inicioEm: 9000 }] }).restanteG;
			expect(saldoArredondado(p.baseG, p.consumidoG + gramas), `${pesoG} ${anteriores} ${gramas}`).toBe(real);
		}
	});

	it('instanteNoFuso lê segundos e milésimos', () => {
		expect(instanteNoFuso('2026-07-15T10:00', 180)).toBe(Date.UTC(2026, 6, 15, 13, 0));
		expect(instanteNoFuso('2026-07-15T10:00:30.5', 0)).toBe(Date.UTC(2026, 6, 15, 10, 0, 30, 500));
	});
});
